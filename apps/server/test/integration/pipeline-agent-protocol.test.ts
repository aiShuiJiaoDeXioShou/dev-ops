import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pipelineLease, pipelineRunLog } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  asRecord,
  completeLease,
  createNode,
  expectFailure,
  getRunDetail,
  heartbeat,
  injectJson,
  listenAndGetBaseUrl,
  parseEnvelope,
  prepareRunningLease,
  registerAgent,
  renewLease,
  reportStepStatus,
  setupPipelineContext,
  startNode,
  stringField,
  uploadArtifact,
  uploadLogs,
  type TestResponse,
} from './pipeline-harness.ts'

/** 断言 Agent 端点失败并校验业务错误码。 */
function expectAgentFailure(response: TestResponse, code: string, label: string): void {
  expectFailure(response, code, label)
}

/** 解析原始响应体为统一信封；二进制下载不套用该函数。 */
function envelopeOf(statusCode: number, body: string) {
  return { statusCode, body, envelope: parseEnvelope({ json: () => JSON.parse(body), body }) }
}

/** 直接发送原始产物请求；返回解析后的信封与状态码。 */
async function rawArtifactRequest(
  baseUrl: string,
  url: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ statusCode: number; body: string }> {
  const response = await fetch(`${baseUrl}${url}`, { method: 'POST', headers, body })
  return { statusCode: response.status, body: await response.text() }
}

/** 读取产物下载响应；返回响应头、正文与请求标识。 */
async function downloadArtifact(
  app: FastifyInstance,
  artifactId: string,
  cookie: string,
): Promise<{ statusCode: number; sha256: string | undefined; body: Buffer; contentType: string | undefined }> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/pipeline-artifacts/${artifactId}/download`,
    headers: { cookie },
  })
  const sha256 = response.headers['x-content-sha256']
  const contentType = response.headers['content-type']
  return {
    statusCode: response.statusCode,
    sha256: typeof sha256 === 'string' ? sha256 : undefined,
    body: response.rawPayload,
    contentType: typeof contentType === 'string' ? contentType : undefined,
  }
}

test('Agent 协议端点：注册/心跳/租约/步骤状态/日志/产物/完成的鉴权、幂等与越权', { timeout: 240_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const baseUrl = await listenAndGetBaseUrl(context.app)
  const { app } = context

  await t.test('注册令牌校验：无效、重复使用、能力越权、版本不支持与节点停用', async () => {
    const invalid = await injectJson(app, 'POST', '/api/v1/agent/register', {
      payload: {
        registrationToken: `preg-invalid-${randomUUID()}`,
        name: `agent-${randomUUID()}`,
        os: 'linux',
        arch: 'x64',
        capabilities: ['linux', 'docker', 'node24'],
        agentVersion: '0.1.0',
      },
    })
    expectAgentFailure(invalid, 'AGENT_REGISTRATION_TOKEN_INVALID', '无效注册令牌')

    const node = await createNode(context, context.admin)
    assert.ok(node.registrationToken, '创建节点应返回一次性注册令牌')
    const firstRegister = await registerAgent(context, { registrationToken: node.registrationToken, name: node.name })
    assert.ok(firstRegister.agentToken.length > 0)
    const reused = await injectJson(app, 'POST', '/api/v1/agent/register', {
      payload: {
        registrationToken: node.registrationToken,
        name: node.name,
        os: 'linux',
        arch: 'x64',
        capabilities: ['linux', 'docker', 'node24'],
        agentVersion: '0.1.0',
      },
    })
    expectAgentFailure(reused, 'AGENT_REGISTRATION_TOKEN_INVALID', '重复使用注册令牌')

    const minimalNode = await createNode(context, context.admin, { capabilities: ['linux'] })
    assert.ok(minimalNode.registrationToken)
    const overreach = await injectJson(app, 'POST', '/api/v1/agent/register', {
      payload: {
        registrationToken: minimalNode.registrationToken,
        name: minimalNode.name,
        os: 'linux',
        arch: 'x64',
        capabilities: ['linux', 'docker', 'node24'],
        agentVersion: '0.1.0',
      },
    })
    expectAgentFailure(overreach, 'AGENT_REGISTRATION_TOKEN_INVALID', '注册能力超出节点授权')

    const versionNode = await createNode(context, context.admin)
    assert.ok(versionNode.registrationToken)
    const unsupportedVersion = await injectJson(app, 'POST', '/api/v1/agent/register', {
      payload: {
        registrationToken: versionNode.registrationToken,
        name: versionNode.name,
        os: 'linux',
        arch: 'x64',
        capabilities: ['linux', 'docker', 'node24'],
        agentVersion: '99.0.0',
      },
    })
    expectAgentFailure(unsupportedVersion, 'AGENT_VERSION_UNSUPPORTED', '不兼容 Agent 版本')

    const disabledNode = await createNode(context, context.admin)
    assert.ok(disabledNode.registrationToken)
    const disabled = await injectJson(app, 'POST', `/api/v1/pipeline-nodes/${disabledNode.nodeId}/disable`, {
      cookie: context.admin.cookie,
    })
    assert.equal(disabled.envelope.success, true, disabled.body)
    const registerDisabled = await injectJson(app, 'POST', '/api/v1/agent/register', {
      payload: {
        registrationToken: disabledNode.registrationToken,
        name: disabledNode.name,
        os: 'linux',
        arch: 'x64',
        capabilities: ['linux', 'docker', 'node24'],
        agentVersion: '0.1.0',
      },
    })
    expectAgentFailure(registerDisabled, 'AGENT_REGISTRATION_TOKEN_INVALID', '停用节点注册（README 口径：令牌已撤销）')
  })

  await t.test('心跳鉴权与令牌轮换：旧令牌立即失效，新令牌可心跳', async () => {
    const unauth = await injectJson(app, 'POST', '/api/v1/agent/heartbeat', {
      payload: { version: '0.1.0', runningLeaseId: null },
    })
    expectAgentFailure(unauth, 'AGENT_TOKEN_INVALID', '缺少 Agent 令牌心跳')

    const node = await startNode(context)
    const beat = await heartbeat(context, node.agentToken, { version: '0.1.0' })
    assert.equal(typeof beat.heartbeatIntervalSeconds, 'number')
    assert.ok(Array.isArray(beat.cancelLeaseIds))

    const rotate = await injectJson(app, 'POST', `/api/v1/pipeline-nodes/${node.nodeId}/tokens/rotate`, {
      cookie: context.admin.cookie,
    })
    assert.equal(rotate.envelope.success, true, rotate.body)
    const newToken = stringField(asRecord(rotate.envelope.data, '轮换响应'), 'agentToken')
    const oldTokenHeartbeat = await injectJson(app, 'POST', '/api/v1/agent/heartbeat', {
      bearer: node.agentToken,
      payload: { version: '0.1.0', runningLeaseId: null },
    })
    expectAgentFailure(oldTokenHeartbeat, 'AGENT_TOKEN_INVALID', '轮换后旧令牌')
    const newTokenHeartbeat = await injectJson(app, 'POST', '/api/v1/agent/heartbeat', {
      bearer: newToken,
      payload: { version: '0.1.0', runningLeaseId: null },
    })
    assert.equal(newTokenHeartbeat.envelope.success, true, newTokenHeartbeat.body)
    const beatData = asRecord(newTokenHeartbeat.envelope.data, '心跳响应')
    assert.ok(Array.isArray(beatData.cancelLeaseIds), '心跳响应应包含 cancelLeaseIds')
  })

  await t.test('租约领取与续约：运行计划固定提交、重复领取返回空、错误令牌与跨节点操作被拒绝', async () => {
    const lease = await prepareRunningLease(context)
    const run = asRecord(lease.lease.run, '租约运行计划')
    assert.equal(stringField(run, 'runId'), lease.runId)
    const detail = await getRunDetail(context, context.developer, lease.runId)
    assert.equal(stringField(run, 'commitSha'), stringField(detail, 'commitSha'))
    const git = asRecord(run.git, '租约 Git 凭据')
    assert.ok(stringField(git, 'remoteUrl').endsWith('.git'))
    assert.equal(stringField(git, 'commitSha'), stringField(detail, 'commitSha'))
    assert.ok('password' in git, '租约应包含短期凭据（仅内存下发）')

    const duplicateClaim = await injectJson(app, 'POST', '/api/v1/agent/lease', {
      bearer: lease.agentToken,
      payload: { waitSeconds: 1 },
    })
    assert.equal(duplicateClaim.envelope.success, true, duplicateClaim.body)
    assert.equal(duplicateClaim.envelope.data, null, '已有活动租约时重复领取应返回 null')

    const wrongToken = await injectJson(app, 'POST', `/api/v1/agent/lease/${lease.leaseId}/renew`, {
      bearer: lease.agentToken,
      headers: { 'x-lease-token': 'x'.repeat(32) },
      payload: { leaseToken: 'x'.repeat(32) },
    })
    expectAgentFailure(wrongToken, 'AGENT_LEASE_INVALID', '错误租约令牌续约')

    const otherNode = await startNode(context)
    const crossRenew = await injectJson(app, 'POST', `/api/v1/agent/lease/${lease.leaseId}/renew`, {
      bearer: otherNode.agentToken,
      headers: { 'x-lease-token': lease.leaseToken },
      payload: { leaseToken: lease.leaseToken },
    })
    expectAgentFailure(crossRenew, 'AGENT_LEASE_INVALID', '跨节点续约')

    const renewed = await renewLease(context, lease.agentToken, lease.leaseId, lease.leaseToken)
    assert.equal(renewed.cancelRequested, false)
    assert.ok(!Number.isNaN(Date.parse(stringField(renewed, 'expiresAt'))))
  })

  await t.test('步骤状态：running→succeeded、重复上报幂等、非法转换冲突、缺少租约令牌', async () => {
    const lease = await prepareRunningLease(context)
    const running = await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, {
      status: 'running',
    })
    assert.equal(stringField(asRecord(running.envelope.data, '步骤状态 data'), 'status'), 'running')
    const afterRunning = await getRunDetail(context, context.developer, lease.runId)
    assert.equal(stringField(afterRunning, 'status'), 'running', '首个步骤 running 后运行应进入 running')

    const repeated = await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, {
      status: 'running',
    })
    assert.equal(repeated.envelope.success, true, '重复上报同一状态应幂等成功')

    const succeeded = await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, {
      status: 'succeeded',
      exitCode: 0,
    })
    assert.equal(stringField(asRecord(succeeded.envelope.data, '步骤状态 data'), 'status'), 'succeeded')

    const illegal = await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, {
      status: 'running',
    })
    expectAgentFailure(illegal, 'AGENT_STEP_STATE_CONFLICT', 'succeeded→running 非法转换')

    const missingLeaseToken = await injectJson(app, 'POST', `/api/v1/agent/lease/${lease.leaseId}/steps/1/status`, {
      bearer: lease.agentToken,
      payload: { status: 'running', exitCode: null, errorCode: null, errorMessage: null },
    })
    expectAgentFailure(missingLeaseToken, 'AGENT_LEASE_INVALID', '缺少 X-Lease-Token')
  })

  await t.test('日志分片：追加、重复 seq 幂等、seq 回退冲突与大小上限', async () => {
    const lease = await prepareRunningLease(context)
    const first = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 1, seq: 0, content: 'line-0\n' },
      { stepIndex: 1, seq: 1, content: 'line-1\n' },
    ])
    assert.equal(first.envelope.success, true, first.body)
    const accepted = asRecord(first.envelope.data, '日志响应')
    assert.equal(asRecord(accepted.acceptedThrough, 'acceptedThrough')['1'], 1)

    const duplicate = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 1, seq: 0, content: 'line-0\n' },
    ])
    assert.equal(duplicate.envelope.success, true, duplicate.body)
    const rows = await app.db.select().from(pipelineRunLog).where(eq(pipelineRunLog.run_id, lease.runId))
    assert.equal(rows.length, 2, '重复日志分片不得重复写入')

    const gap = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 1, seq: 3, content: 'line-3\n' },
    ])
    assert.equal(gap.envelope.success, true, gap.body)
    const backwards = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 1, seq: 2, content: 'line-2\n' },
    ])
    expectAgentFailure(backwards, 'AGENT_LOG_SEQ_CONFLICT', 'seq 回退且分片缺失')

    const oversized = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 1, seq: 100, content: 'x'.repeat(300_000) },
    ])
    expectAgentFailure(oversized, 'AGENT_LOG_LIMIT_EXCEEDED', '日志分片超过大小上限')

    const wrongStep = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 99, seq: 0, content: 'orphan\n' },
    ])
    expectAgentFailure(wrongStep, 'AGENT_LEASE_INVALID', '日志步骤越权')
  })

  await t.test('产物上传：成功、校验和、重复名冲突、非产物步骤拒绝、列表与鉴权下载', async () => {
    const lease = await prepareRunningLease(context)
    const content = Buffer.from('artifact-payload')
    const sha = createHash('sha256').update(content).digest('hex')
    const uploaded = await uploadArtifact(baseUrl, lease.agentToken, lease.leaseId, lease.leaseToken, {
      stepIndex: 3,
      name: 'web-dist',
      content,
    })
    assert.equal(uploaded.name, 'web-dist')
    assert.equal(uploaded.sizeBytes, content.byteLength)
    assert.equal(uploaded.sha256, sha)

    const duplicate = await rawArtifactRequest(
      baseUrl,
      `/api/v1/agent/lease/${lease.leaseId}/artifacts`,
      {
        authorization: `Bearer ${lease.agentToken}`,
        'x-lease-token': lease.leaseToken,
        'x-step-index': '3',
        'x-artifact-name': 'web-dist',
        'x-content-sha256': sha,
        'content-type': 'application/octet-stream',
      },
      content,
    )
    assert.equal(duplicate.statusCode, 200)
    const duplicateEnvelope = envelopeOf(duplicate.statusCode, duplicate.body).envelope
    assert.equal(duplicateEnvelope.success, false, '重复产物名应失败')
    assert.equal(duplicateEnvelope.code, 'PIPELINE_ARTIFACT_CONFLICT')

    const changed = Buffer.from('artifact-payload-mismatch')
    const mismatch = await rawArtifactRequest(
      baseUrl,
      `/api/v1/agent/lease/${lease.leaseId}/artifacts`,
      {
        authorization: `Bearer ${lease.agentToken}`,
        'x-lease-token': lease.leaseToken,
        'x-step-index': '3',
        'x-artifact-name': 'sha-mismatch',
        'x-content-sha256': sha,
        'content-type': 'application/octet-stream',
      },
      changed,
    )
    const mismatchEnvelope = envelopeOf(mismatch.statusCode, mismatch.body).envelope
    assert.equal(mismatchEnvelope.success, false, '校验和不一致应失败')
    assert.equal(mismatchEnvelope.code, 'VALIDATION_ERROR')

    const wrongStep = await rawArtifactRequest(
      baseUrl,
      `/api/v1/agent/lease/${lease.leaseId}/artifacts`,
      {
        authorization: `Bearer ${lease.agentToken}`,
        'x-lease-token': lease.leaseToken,
        'x-step-index': '0',
        'x-artifact-name': 'wrong-step',
        'x-content-sha256': sha,
        'content-type': 'application/octet-stream',
      },
      content,
    )
    assert.equal(envelopeOf(wrongStep.statusCode, wrongStep.body).envelope.success, false, '非产物步骤上传应失败')

    const list = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/artifacts`, {
      cookie: context.viewer.cookie,
    })
    assert.equal(list.envelope.success, true, list.body)
    const artifactItems = asRecord(list.envelope.data, '产物列表').items
    assert.ok(Array.isArray(artifactItems), '产物列表应包含 items 数组')
    assert.equal(artifactItems.length, 1, '已上传产物应立即出现在列表')
    const item = asRecord(artifactItems[0], '产物列表项')
    assert.equal(stringField(item, 'artifactId'), uploaded.artifactId)
    assert.equal(stringField(item, 'sha256'), sha)
    assert.equal(stringField(item, 'name'), 'web-dist')
    assert.ok(stringField(item, 'downloadUrl').includes(uploaded.artifactId))

    const downloaded = await downloadArtifact(app, uploaded.artifactId, context.viewer.cookie)
    assert.equal(downloaded.statusCode, 200)
    assert.equal(downloaded.sha256, sha)
    assert.equal(downloaded.body.equals(content), true, '下载内容应与上传一致')
    assert.ok((downloaded.contentType ?? '').includes('application/octet-stream'))

    const crossTeam = await downloadArtifact(app, uploaded.artifactId, context.stranger.cookie)
    assert.equal(crossTeam.statusCode, 200)
    const crossTeamEnvelope = envelopeOf(crossTeam.statusCode, crossTeam.body.toString('utf8')).envelope
    assert.equal(crossTeamEnvelope.success, false, '跨团队下载应被拒绝')
    assert.equal(crossTeamEnvelope.code, 'FORBIDDEN')
  })

  await t.test('产物超限：超过平台大小上限返回 AGENT_ARTIFACT_LIMIT_EXCEEDED', async () => {
    const lease = await prepareRunningLease(context)
    const oversizedContent = Buffer.alloc(1_048_601, 0x61)
    const sha = createHash('sha256').update(oversizedContent).digest('hex')
    let response
    try {
      response = await fetch(`${baseUrl}/api/v1/agent/lease/${lease.leaseId}/artifacts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${lease.agentToken}`,
          'x-lease-token': lease.leaseToken,
          'x-step-index': '3',
          'x-artifact-name': 'oversized-dist',
          'x-content-sha256': sha,
          'content-type': 'application/octet-stream',
        },
        body: oversizedContent,
      })
    } catch (error) {
      throw new Error(`D7：超限产物应返回 AGENT_ARTIFACT_LIMIT_EXCEEDED 统一信封，实际连接被重置：${String(error)}`)
    }
    const body = await response.text()
    const envelope = envelopeOf(response.status, body).envelope
    assert.equal(envelope.success, false, `超限产物应失败：${body}`)
    assert.equal(envelope.code, 'AGENT_ARTIFACT_LIMIT_EXCEEDED', `超限产物错误码应可识别：${body}`)
  })

  await t.test('完成上报：成功终态、重复完成幂等、终态后写入拒绝与错误令牌拒绝', async () => {
    const lease = await prepareRunningLease(context)
    const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
      status: 'succeeded',
    })
    assert.equal(completed.envelope.success, true, completed.body)
    const completeData = asRecord(completed.envelope.data, '完成响应')
    assert.equal(stringField(completeData, 'runId'), lease.runId)
    assert.equal(stringField(completeData, 'status'), 'succeeded')

    const detail = await getRunDetail(context, context.developer, lease.runId)
    assert.equal(stringField(detail, 'status'), 'succeeded')
    assert.ok(detail.finishedAt !== null)
    const leaseRows = await app.db.select().from(pipelineLease).where(eq(pipelineLease.id, lease.leaseId))
    assert.equal(leaseRows[0]?.status, 'released')

    const duplicate = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
      status: 'succeeded',
    })
    assert.equal(duplicate.envelope.success, true, duplicate.body)
    assert.equal(stringField(asRecord(duplicate.envelope.data, '重复完成响应'), 'status'), 'succeeded')

    const lateLog = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
      { stepIndex: 1, seq: 999, content: 'late\n' },
    ])
    expectAgentFailure(lateLog, 'AGENT_LEASE_INVALID', '终态后上传日志')

    const wrongToken = await completeLease(context, lease.agentToken, lease.leaseId, 'y'.repeat(32), {
      status: 'succeeded',
    })
    expectAgentFailure(wrongToken, 'AGENT_LEASE_INVALID', '错误租约令牌完成')
  })
})
