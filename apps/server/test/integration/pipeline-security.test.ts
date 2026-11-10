import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import { pipelineNodeToken } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  asRecord,
  createNode,
  expectFailure,
  getRunDetail,
  heartbeat,
  injectJson,
  items,
  prepareRunningLease,
  setupPipelineContext,
  startNode,
  stringField,
  triggerRun,
  uploadLogs,
} from './pipeline-harness.ts'

const SECRET_WORKFLOW_PATH = '.devops/workflows/ci-secret.yml'
const SECRET_VALUE = 'super-secret-value-12345'
const SECRET_WORKFLOW = `name: secret-build
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
      - name: Use secret
        run: echo "$NPM_TOKEN"
        env:
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
`

/** 创建只读 API Token；返回可放进 Authorization 的明文。 */
async function createReadToken(
  context: Awaited<ReturnType<typeof setupPipelineContext>>,
  cookie: string,
): Promise<string> {
  const response = await injectJson(context.app, 'POST', '/api/v1/me/tokens', {
    cookie,
    payload: { name: `security-${randomUUID()}` },
  })
  assert.equal(response.envelope.success, true, response.body)
  return stringField(asRecord(response.envelope.data, 'Token 响应'), 'token')
}

test(
  'T085/T086 安全矩阵：节点管理权限、跨团队、令牌哈希、停用节点、凭据与密钥脱敏、日志脱敏',
  { timeout: 240_000 },
  async (t) => {
    const context = await setupPipelineContext(t)
    const { app } = context
    context.git.setFile(SECRET_WORKFLOW_PATH, SECRET_WORKFLOW)
    context.credentials.setSecret('NPM_TOKEN', SECRET_VALUE)

    await t.test('角色矩阵：节点列表/创建/排空/轮换仅团队管理员可用', async () => {
      for (const actor of [context.viewer, context.developer, context.stranger]) {
        const list = await injectJson(app, 'GET', `/api/v1/teams/${context.teamId}/pipeline-nodes`, {
          cookie: actor.cookie,
        })
        expectFailure(list, 'FORBIDDEN', '非管理员读取节点列表')
        const create = await injectJson(app, 'POST', `/api/v1/teams/${context.teamId}/pipeline-nodes`, {
          cookie: actor.cookie,
          payload: { name: `forbidden-${randomUUID()}`, capabilities: ['linux'] },
        })
        expectFailure(create, 'FORBIDDEN', '非管理员创建节点')
      }
      const node = await createNode(context, context.admin)
      for (const actor of [context.viewer, context.developer]) {
        const drain = await injectJson(app, 'POST', `/api/v1/pipeline-nodes/${node.nodeId}/drain`, {
          cookie: actor.cookie,
        })
        expectFailure(drain, 'FORBIDDEN', '非管理员排空节点')
        const rotate = await injectJson(app, 'POST', `/api/v1/pipeline-nodes/${node.nodeId}/tokens/rotate`, {
          cookie: actor.cookie,
        })
        expectFailure(rotate, 'FORBIDDEN', '非管理员轮换令牌')
      }
      const adminList = await injectJson(app, 'GET', `/api/v1/teams/${context.teamId}/pipeline-nodes`, {
        cookie: context.admin.cookie,
      })
      assert.equal(adminList.envelope.success, true, adminList.body)
      const listData = asRecord(adminList.envelope.data, '节点列表')
      assert.ok(Array.isArray(listData.items))
      for (const item of items(listData)) {
        const record = asRecord(item, '节点列表项')
        assert.equal('agentToken' in record, false, '节点列表不得返回 Agent 令牌')
        assert.equal('registrationToken' in record, false, '节点列表不得返回注册令牌')
      }
    })

    await t.test('跨团队与匿名访问：运行、日志、产物与节点均拒绝，API Token 继承账号权限', async () => {
      const run = await triggerRun(context, context.developer, { idempotencyKey: `security-${randomUUID()}` })
      const strangerDetail = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${run.runId}`, {
        cookie: context.stranger.cookie,
      })
      expectFailure(strangerDetail, 'FORBIDDEN', '跨团队读取运行详情')
      const anonymousDetail = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${run.runId}`)
      expectFailure(anonymousDetail, 'UNAUTHENTICATED', '匿名读取运行详情')
      const otherTeamNodes = await injectJson(app, 'GET', `/api/v1/teams/${context.otherTeam.teamId}/pipeline-nodes`, {
        cookie: context.admin.cookie,
      })
      expectFailure(otherTeamNodes, 'FORBIDDEN', '跨团队读取节点列表')

      const viewerToken = await createReadToken(context, context.viewer.cookie)
      const tokenRead = await injectJson(app, 'GET', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
        bearer: viewerToken,
      })
      assert.equal(tokenRead.envelope.success, true, tokenRead.body)
      const tokenTrigger = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
        bearer: viewerToken,
        payload: {
          workflowPath: '.devops/workflows/ci.yml',
          ref: 'main',
          idempotencyKey: `token-trigger-${randomUUID()}`,
        },
      })
      expectFailure(tokenTrigger, 'FORBIDDEN', '浏览者 API Token 触发运行')
      const tokenRun = await triggerRun(context, context.developer, { idempotencyKey: `token-channel-${randomUUID()}` })
      assert.equal(stringField(tokenRun.data, 'initiatorChannel'), 'web', '会话触发渠道为 web')
    })

    await t.test('节点令牌只保存哈希，明文只在创建/轮换响应出现一次', async () => {
      const node = await createNode(context, context.admin)
      assert.ok(node.registrationToken, '创建节点应返回一次性注册令牌')
      const tokens = await app.db.select().from(pipelineNodeToken).where(eq(pipelineNodeToken.node_id, node.nodeId))
      assert.equal(tokens.length, 1)
      const registration = tokens[0]
      if (!registration) throw new Error('注册令牌记录不存在')
      assert.notEqual(registration.token_hash, node.registrationToken, '数据库中不得保存令牌明文')
      assert.equal(registration.token_hash, createHash('sha256').update(node.registrationToken).digest('hex'))
      assert.match(registration.token_hash, /^[0-9a-f]{64}$/)

      const register = await injectJson(app, 'POST', '/api/v1/agent/register', {
        payload: {
          registrationToken: node.registrationToken,
          name: node.name,
          os: 'linux',
          arch: 'x64',
          capabilities: ['linux', 'docker', 'node24'],
          agentVersion: '0.1.0',
        },
      })
      assert.equal(register.envelope.success, true, register.body)
      const agentToken = stringField(asRecord(register.envelope.data, '注册响应'), 'agentToken')
      const afterRegister = await app.db
        .select()
        .from(pipelineNodeToken)
        .where(eq(pipelineNodeToken.node_id, node.nodeId))
      for (const token of afterRegister) {
        assert.notEqual(token.token_hash, node.registrationToken)
        assert.notEqual(token.token_hash, agentToken)
        assert.equal(token.token_hash.length, 64)
      }
    })

    await t.test('停用节点：撤销 Agent 令牌且后续请求被拒绝，写节点活动记录', async () => {
      const node = await startNode(context)
      const beat = await heartbeat(context, node.agentToken, { version: '0.1.0' })
      assert.ok(Array.isArray(beat.cancelLeaseIds))
      const disable = await injectJson(app, 'POST', `/api/v1/pipeline-nodes/${node.nodeId}/disable`, {
        cookie: context.admin.cookie,
      })
      assert.equal(disable.envelope.success, true, disable.body)
      const rejected = await injectJson(app, 'POST', '/api/v1/agent/heartbeat', {
        bearer: node.agentToken,
        payload: { version: '0.1.0', runningLeaseId: null },
      })
      assert.equal(rejected.envelope.success, false)
      assert.ok(['AGENT_TOKEN_INVALID', 'AGENT_NODE_DISABLED'].includes(rejected.envelope.code))

      const nodeActivities = await app.db.select().from(activity).where(eq(activity.entity_type, 'pipeline_node'))
      const actions = nodeActivities.map((row) => row.action)
      assert.ok(actions.includes('pipeline_node_registered'), '创建节点应写活动记录')
      assert.ok(actions.includes('pipeline_node_disabled'), '停用节点应写活动记录')
      for (const row of nodeActivities) {
        const serialized = JSON.stringify(row)
        assert.equal(serialized.includes('preg-'), false, '活动记录不得包含令牌明文')
      }
    })

    await t.test('Git 凭据与运行时密钥不进入平台运行视图/活动/日志', async () => {
      const secretRun = await triggerRun(context, context.developer, {
        workflowPath: SECRET_WORKFLOW_PATH,
        idempotencyKey: `secret-run-${randomUUID()}`,
      })
      const detail = await getRunDetail(context, context.viewer, secretRun.runId)
      const detailBody = JSON.stringify(detail)
      assert.equal(detailBody.includes(SECRET_VALUE), false, '运行详情不得包含运行时密钥明文')
      assert.equal(detailBody.includes('test-token'), false, '运行详情不得包含 Git 短期凭据')
      const listResponse = await injectJson(
        app,
        'GET',
        `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=100`,
        { cookie: context.viewer.cookie },
      )
      for (const item of items(asRecord(listResponse.envelope.data, '运行列表'))) {
        const serialized = JSON.stringify(item)
        assert.equal(serialized.includes(SECRET_VALUE), false, '运行列表不得包含密钥明文')
        assert.equal(serialized.includes('test-token'), false, '运行列表不得包含 Git 凭据')
      }

      const lease = await prepareRunningLease(context, { workflowPath: SECRET_WORKFLOW_PATH })
      const runPlan = asRecord(lease.lease.run, '租约运行计划')
      const secrets = asRecord(runPlan.secrets, '租约密钥')
      assert.equal(secrets.NPM_TOKEN, SECRET_VALUE, 'Agent 租约应获得运行时密钥（仅内存/租约下发）')
      const jobs = runPlan.jobs
      assert.ok(Array.isArray(jobs))
      const jobRecord = asRecord(jobs[0], '租约 job')
      const stepList = jobRecord.steps
      assert.ok(Array.isArray(stepList))
      const useStep = asRecord(stepList[1], '使用密钥步骤')
      assert.equal(asRecord(useStep.env, '步骤环境变量').NPM_TOKEN, SECRET_VALUE)

      // 直接读取持久化计划模板，确认只保存占位引用；表名与列名固定，不拼接外部输入。
      const rows = await app.db.execute(
        sql`select run_plan::text as plan, workflow_snapshot as snapshot from app.pipeline_run where id = ${secretRun.runId}`,
      )
      const persisted = JSON.stringify(rows.rows)
      assert.equal(persisted.includes(SECRET_VALUE), false, '持久化运行计划不得包含密钥明文')
      assert.ok(persisted.includes('secrets.NPM_TOKEN'), '持久化运行计划应保留密钥引用占位')
      assert.equal(context.credentials.issueCount() > 0, true, '租约领取应签发短期 Git 凭据')

      const logSecretLeak = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
        { stepIndex: 1, seq: 1, content: `running with ${SECRET_VALUE}\n` },
      ])
      assert.equal(logSecretLeak.envelope.success, true, logSecretLeak.body)
      const readBack = await injectJson(
        app,
        'GET',
        `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1&afterSeq=0`,
        { cookie: context.viewer.cookie },
      )
      const logText = JSON.stringify(readBack.envelope.data)
      assert.equal(logText.includes(SECRET_VALUE), false, '平台日志读取不得包含运行时密钥明文')
    })

    await t.test('日志与错误信息脱敏：Bearer/密码/连接串/GitHub 令牌形态被遮蔽', async () => {
      const lease = await prepareRunningLease(context)
      const tokenLike = `ghp_${'a'.repeat(30)}`
      const raw = [
        'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
        'password=hunter2-secret',
        'postgresql://dev:dbpassword@127.0.0.1:5432/app',
        `token=${tokenLike}`,
      ].join('\n')
      const upload = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
        { stepIndex: 1, seq: 1, content: raw },
      ])
      assert.equal(upload.envelope.success, true, upload.body)
      const readBack = await injectJson(
        app,
        'GET',
        `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1&afterSeq=0`,
        { cookie: context.viewer.cookie },
      )
      const logItems = items(asRecord(readBack.envelope.data, '日志 data'))
      const firstLog = logItems[0]
      if (!firstLog) throw new Error('日志读取结果为空')
      const content = stringField(asRecord(firstLog, '日志分片'), 'content')
      assert.equal(content.includes('abcdefghijklmnopqrstuvwxyz'), false, 'Bearer 令牌应被脱敏')
      assert.equal(content.includes('hunter2-secret'), false, '密码应被脱敏')
      assert.equal(content.includes('dbpassword'), false, '连接串口令应被脱敏')
      assert.equal(content.includes(tokenLike), false, 'GitHub 令牌应被脱敏')
      assert.ok(content.includes('***'), '脱敏结果应保留掩码标记')
    })

    await t.test('触发输入摘要对敏感字段名脱敏，运行详情不返回原始输入', async () => {
      const run = await triggerRun(context, context.developer, {
        inputs: { target: 'web' },
        idempotencyKey: `input-mask-${randomUUID()}`,
      })
      const detail = await getRunDetail(context, context.viewer, run.runId)
      const inputs = asRecord(detail.inputs, '输入摘要')
      assert.equal(inputs.target, 'web')
      assert.equal(JSON.stringify(detail).includes('test-token'), false, '运行详情不得包含 Git 凭据')
    })
  },
)
