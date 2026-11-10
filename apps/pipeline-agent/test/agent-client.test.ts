import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createAgentClient } from '../src/agent.ts'
import type { AgentClient } from '../src/agent.ts'
import { createPlatformHttp } from '../src/client.ts'
import { AGENT_ERROR_CODES, AgentApiError } from '../src/errors.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { createLease } from './helpers/fixtures.ts'
import {
  errorEnvelope,
  headerOf,
  jsonBody,
  okEnvelope,
  requestsTo,
  requiredRequest,
  startMockPlatform,
} from './helpers/platform-server.ts'
import type { MockPlatform } from './helpers/platform-server.ts'

const REGISTRATION_TOKEN = 'registration-token-0123456789abcdef'
const AGENT_TOKEN = 'agent-token-012345678901234567890123456789'

interface TestHarness {
  client: AgentClient
  logLines: string[]
  masker: ReturnType<typeof createSecretMasker>
}

function createHarness(platform: MockPlatform): TestHarness {
  const logLines: string[] = []
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: (line) => logLines.push(line) })
  const http = createPlatformHttp({
    baseUrl: platform.url,
    timeoutMs: 2_000,
    retry: { baseDelayMs: 1, maxDelayMs: 5 },
    logger,
    sleep: async () => undefined,
  })
  const client = createAgentClient({
    http,
    logger,
    masker,
    nodeName: 'test-node',
    capabilities: ['linux', 'docker'],
    registrationToken: REGISTRATION_TOKEN,
    artifactUploadTimeoutMs: 5_000,
  })
  return { client, logLines, masker }
}

const REGISTER_RESPONSE = {
  nodeId: 'node-test-1',
  agentToken: AGENT_TOKEN,
  protocolVersion: 1,
  heartbeatIntervalSeconds: 15,
  leaseTtlSeconds: 90,
}

test('注册使用一次性令牌换取长期令牌，重复调用不重复注册', async () => {
  const platform = await startMockPlatform((request) => {
    assert.equal(request.path, '/api/v1/agent/register')
    return okEnvelope(REGISTER_RESPONSE)
  })
  try {
    const { client, logLines } = createHarness(platform)
    const first = await client.ensureRegistered()
    const second = await client.ensureRegistered()
    assert.deepEqual(first, second)
    assert.equal(client.hasAgentToken, true)
    assert.equal(requestsTo(platform.requests, '/api/v1/agent/register').length, 1)
    const body = jsonBody(requiredRequest(platform.requests, '/api/v1/agent/register'))
    assert.equal(body.registrationToken, REGISTRATION_TOKEN)
    assert.equal(body.name, 'test-node')
    assert.deepEqual(body.capabilities, ['linux', 'docker'])
    assert.equal(typeof body.os, 'string')
    assert.equal(typeof body.arch, 'string')
    assert.equal(typeof body.agentVersion, 'string')
    const logs = logLines.join('\n')
    assert.ok(!logs.includes(REGISTRATION_TOKEN), '日志不得包含注册令牌')
    assert.ok(!logs.includes(AGENT_TOKEN), '日志不得包含 Agent 令牌')
  } finally {
    await platform.close()
  }
})

test('心跳、租约、续约、步骤状态、日志与完成上报使用协议路径与鉴权头', async () => {
  const lease = createLease()
  const platform = await startMockPlatform((request) => {
    switch (request.path) {
      case '/api/v1/agent/register':
        return okEnvelope(REGISTER_RESPONSE)
      case '/api/v1/agent/heartbeat':
        return okEnvelope({ cancelLeaseIds: [lease.leaseId], heartbeatIntervalSeconds: 15 })
      case '/api/v1/agent/lease':
        return okEnvelope(lease)
      case `/api/v1/agent/lease/${lease.leaseId}/renew`:
        return okEnvelope({ expiresAt: lease.expiresAt, cancelRequested: true })
      case `/api/v1/agent/lease/${lease.leaseId}/steps/1/status`:
        return okEnvelope({ stepIndex: 1, status: 'running' })
      case `/api/v1/agent/lease/${lease.leaseId}/logs`:
        return okEnvelope({ acceptedThrough: { '1': 0 } })
      case `/api/v1/agent/lease/${lease.leaseId}/complete`:
        return okEnvelope({ runId: lease.run.runId, status: 'succeeded' })
      default:
        throw new Error(`未预期的路径：${request.path}`)
    }
  })
  try {
    const { client } = createHarness(platform)
    await client.ensureRegistered()
    const heartbeat = await client.heartbeat(null)
    assert.deepEqual(heartbeat.cancelLeaseIds, [lease.leaseId])
    const acquired = await client.acquireLease(20)
    assert.equal(acquired?.leaseId, lease.leaseId)
    if (!acquired) throw new Error('租约不应为空')
    const renewal = await client.renewLease(acquired)
    assert.equal(renewal.cancelRequested, true)
    const status = await client.reportStepStatus(acquired, 1, { status: 'running' })
    assert.equal(status.status, 'running')
    const logs = await client.uploadLogs(acquired, [{ stepIndex: 1, seq: 0, content: 'hello\n' }])
    assert.equal(logs.acceptedThrough['1'], 0)
    const complete = await client.complete(acquired, { status: 'succeeded' })
    assert.equal(complete.status, 'succeeded')

    for (const request of platform.requests.filter((item) => item.path !== '/api/v1/agent/register')) {
      assert.equal(headerOf(request, 'authorization'), `Bearer ${AGENT_TOKEN}`)
    }
    const scopedPaths = [
      `/api/v1/agent/lease/${lease.leaseId}/renew`,
      `/api/v1/agent/lease/${lease.leaseId}/steps/1/status`,
      `/api/v1/agent/lease/${lease.leaseId}/logs`,
      `/api/v1/agent/lease/${lease.leaseId}/complete`,
    ]
    for (const path of scopedPaths) {
      const request = platform.requests.find((item) => item.path === path)
      assert.ok(request, `缺少请求：${path}`)
      assert.equal(headerOf(request, 'x-lease-token'), lease.leaseToken)
    }
    const heartbeatBody = jsonBody(requiredRequest(platform.requests, '/api/v1/agent/heartbeat'))
    assert.equal(heartbeatBody.runningLeaseId, null)
    const renewBody = jsonBody(requiredRequest(platform.requests, `/api/v1/agent/lease/${lease.leaseId}/renew`))
    assert.equal(renewBody.leaseToken, lease.leaseToken)
  } finally {
    await platform.close()
  }
})

test('无任务时租约响应 data=null 映射为 null', async () => {
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') return okEnvelope(REGISTER_RESPONSE)
    return okEnvelope(null)
  })
  try {
    const { client } = createHarness(platform)
    await client.ensureRegistered()
    assert.equal(await client.acquireLease(0), null)
  } finally {
    await platform.close()
  }
})

test('业务错误不重试并抛出稳定错误码', async () => {
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') return okEnvelope(REGISTER_RESPONSE)
    return errorEnvelope(AGENT_ERROR_CODES.leaseExpired, '租约已过期')
  })
  try {
    const { client } = createHarness(platform)
    await client.ensureRegistered()
    await assert.rejects(
      () => client.acquireLease(0),
      (error: unknown) => error instanceof AgentApiError && error.code === AGENT_ERROR_CODES.leaseExpired,
    )
    assert.equal(requestsTo(platform.requests, '/api/v1/agent/lease').length, 1, '业务错误不得重试')
  } finally {
    await platform.close()
  }
})

test('HTTP 500 按指数退避重试后成功', async () => {
  let failures = 2
  const lease = createLease()
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') return okEnvelope(REGISTER_RESPONSE)
    if (failures > 0) {
      failures -= 1
      return { status: 500, body: { success: false, code: 'PIPELINE_STORAGE_ERROR', message: '内部错误' } }
    }
    return okEnvelope(lease)
  })
  try {
    const { client, logLines } = createHarness(platform)
    await client.ensureRegistered()
    const acquired = await client.acquireLease(0)
    assert.equal(acquired?.leaseId, lease.leaseId)
    assert.equal(requestsTo(platform.requests, '/api/v1/agent/lease').length, 3, '应重试至第 3 次成功')
    assert.ok(
      logLines.some((line) => line.includes('重试')),
      '应记录重试告警',
    )
  } finally {
    await platform.close()
  }
})

test('产物流式上传携带协议请求头且请求体为原始字节', async () => {
  const lease = createLease()
  const content = Buffer.from('fake-tar-content', 'utf8')
  const sha256 = 'b'.repeat(64)
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') return okEnvelope(REGISTER_RESPONSE)
    if (request.path === `/api/v1/agent/lease/${lease.leaseId}/artifacts`) {
      return okEnvelope({ artifactId: 'artifact-1', name: 'web-dist', sizeBytes: content.byteLength, sha256 })
    }
    return errorEnvelope('UNEXPECTED', request.path)
  })
  const dir = await mkdtemp(join(tmpdir(), 'devops-agent-artifact-'))
  try {
    const artifactPath = join(dir, 'bundle.tar')
    await writeFile(artifactPath, content)
    const { client } = createHarness(platform)
    await client.ensureRegistered()
    const result = await client.uploadArtifact(lease, {
      stepIndex: 3,
      name: 'web-dist',
      sha256,
      sizeBytes: content.byteLength,
      filePath: artifactPath,
    })
    assert.equal(result.artifactId, 'artifact-1')
    const request = requestsTo(platform.requests, `/api/v1/agent/lease/${lease.leaseId}/artifacts`)[0]
    assert.ok(request, '应收到产物上传请求')
    assert.equal(headerOf(request, 'x-step-index'), '3')
    assert.equal(headerOf(request, 'x-artifact-name'), 'web-dist')
    assert.equal(headerOf(request, 'x-content-sha256'), sha256)
    assert.equal(headerOf(request, 'content-length'), String(content.byteLength))
    assert.equal(headerOf(request, 'x-lease-token'), lease.leaseToken)
    assert.deepEqual(request.body, content)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await platform.close()
  }
})

test('平台响应缺字段时视为协议错误，不继续执行', async () => {
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') return okEnvelope({ nodeId: 'only-node-id' })
    return okEnvelope(null)
  })
  try {
    const { client } = createHarness(platform)
    await assert.rejects(() => client.ensureRegistered(), /协议|字段/)
  } finally {
    await platform.close()
  }
})

test('租约领取请求超时覆盖平台 waitSeconds 长轮询，避免响应丢失', async () => {
  const lease = createLease()
  const platform = await startMockPlatform(async (request) => {
    if (request.path === '/api/v1/agent/register') return okEnvelope(REGISTER_RESPONSE)
    if (request.path === '/api/v1/agent/lease') {
      // 模拟平台长轮询内部等待；控制请求默认超时只有 50ms，必须被 waitSeconds 覆盖。
      await new Promise((resolve) => setTimeout(resolve, 300))
      return okEnvelope(lease)
    }
    throw new Error(`未预期路径：${request.path}`)
  })
  try {
    const masker = createSecretMasker()
    const logger = createAgentLogger({ masker, write: () => undefined })
    const http = createPlatformHttp({
      baseUrl: platform.url,
      timeoutMs: 50,
      sleep: async () => undefined,
      logger,
    })
    const client = createAgentClient({
      http,
      logger,
      masker,
      nodeName: 'test-node',
      capabilities: ['linux'],
      registrationToken: REGISTRATION_TOKEN,
      artifactUploadTimeoutMs: 5_000,
    })
    await client.ensureRegistered()
    const acquired = await client.acquireLease(1)
    assert.equal(acquired?.leaseId, lease.leaseId)
    assert.equal(requestsTo(platform.requests, '/api/v1/agent/lease').length, 1, '不应因短超时重试领取')
  } finally {
    await platform.close()
  }
})
