import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { pipelineLease, pipelineNode, pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  asRecord,
  completeLease,
  createNode,
  createPipelineSchedulerForTest,
  getRunDetail,
  injectJson,
  items,
  offlineOtherNodes,
  prepareRunningLease,
  registerAgent,
  setupPipelineContext,
  startNode,
  stringField,
  triggerRun,
  type PipelineTestContext,
} from './pipeline-harness.ts'

/** 读取运行行；不存在时抛错。 */
async function runRow(context: PipelineTestContext, runId: string) {
  const rows = await context.app.db.select().from(pipelineRun).where(eq(pipelineRun.id, runId))
  const row = rows[0]
  if (!row) throw new Error(`运行不存在：${runId}`)
  return row
}

/** 读取租约行；不存在时抛错。 */
async function leaseRow(context: PipelineTestContext, leaseId: string) {
  const rows = await context.app.db.select().from(pipelineLease).where(eq(pipelineLease.id, leaseId))
  const row = rows[0]
  if (!row) throw new Error(`租约不存在：${leaseId}`)
  return row
}

/** 判断未知错误链是否带数据库错误码；Drizzle 会把驱动错误放在 cause 中。 */
function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('cause' in error) return databaseErrorCode(error.cause)
  return null
}

test(
  'T040 Worker 调度：能力匹配、并发上限、租约唯一、心跳超时、租约过期与排队超时',
  { timeout: 180_000 },
  async (t) => {
    const context = await setupPipelineContext(t)
    const scheduler = createPipelineSchedulerForTest(context)

    await t.test('按 runs-on 能力标签匹配节点，不匹配的节点不被调度', async () => {
      const partialNode = await createNode(context, context.admin, { capabilities: ['linux'] })
      assert.ok(partialNode.registrationToken, '创建节点应返回一次性注册令牌')
      await registerAgent(context, {
        registrationToken: partialNode.registrationToken,
        name: partialNode.name,
        capabilities: ['linux'],
      })
      await offlineOtherNodes(context, [partialNode.nodeId])
      const run = await triggerRun(context, context.developer, { idempotencyKey: `cap-${randomUUID()}` })
      const firstCycle = await scheduler.runCycle()
      assert.equal(firstCycle.scheduledRuns, 0, '缺少 docker/node24 标签的节点不应被调度')
      const queued = await getRunDetail(context, context.developer, run.runId)
      assert.equal(stringField(queued, 'status'), 'queued')
      assert.equal(queued.nodeId, null, '未调度运行不应绑定节点')

      const fullNode = await startNode(context)
      const secondCycle = await scheduler.runCycle()
      assert.equal(secondCycle.scheduledRuns, 1, '具备全部能力标签的节点应被调度')
      const assigned = await getRunDetail(context, context.developer, run.runId)
      assert.equal(stringField(assigned, 'status'), 'assigned')
      assert.equal(stringField(assigned, 'nodeId'), fullNode.nodeId)
      assert.equal(stringField(assigned, 'nodeName'), fullNode.name)
    })

    await t.test('节点并发上限为 1：已有活动租约时不再分配新运行', async () => {
      const lease = await prepareRunningLease(context)
      const detail = await getRunDetail(context, context.developer, lease.runId)
      assert.ok(
        ['assigned', 'running'].includes(stringField(detail, 'status')),
        '领取租约后运行应处于 assigned/running',
      )

      const secondRun = await triggerRun(context, context.developer, { idempotencyKey: `capacity-${randomUUID()}` })
      const cycle = await scheduler.runCycle()
      assert.equal(cycle.scheduledRuns, 0, '节点并发已满时不应再分配运行')
      const secondDetail = await getRunDetail(context, context.developer, secondRun.runId)
      assert.equal(stringField(secondDetail, 'status'), 'queued', '超出并发上限的运行应保持排队')

      const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
        status: 'succeeded',
      })
      assert.equal(completed.envelope.success, true, completed.body)
      assert.equal(stringField(asRecord(completed.envelope.data, '完成上报 data'), 'status'), 'succeeded')
      const nextCycle = await scheduler.runCycle()
      assert.equal(nextCycle.scheduledRuns, 1, '租约释放后应重新调度排队运行')
      const reassigned = await getRunDetail(context, context.developer, secondRun.runId)
      assert.equal(stringField(reassigned, 'status'), 'assigned')
    })

    await t.test('同一运行最多一个活动租约（部分唯一索引兜底）', async () => {
      const lease = await prepareRunningLease(context)
      const duplicate = {
        id: randomUUID(),
        team_id: context.teamId,
        project_id: context.projectId,
        run_id: lease.runId,
        node_id: lease.nodeId,
        lease_token_hash: 'f'.repeat(64),
        status: 'active',
        expires_at: new Date(Date.now() + 60_000),
      }
      await assert.rejects(
        () => context.app.db.insert(pipelineLease).values(duplicate),
        (error: unknown) => databaseErrorCode(error) === '23505',
      )
      const leases = await context.app.db
        .select()
        .from(pipelineLease)
        .where(and(eq(pipelineLease.run_id, lease.runId), eq(pipelineLease.status, 'active')))
      assert.equal(leases.length, 1)
    })

    await t.test('心跳超时：节点离线、租约过期、运行标记 interrupted', async () => {
      const lease = await prepareRunningLease(context)
      await context.app.db
        .update(pipelineNode)
        .set({ last_heartbeat_at: new Date(Date.now() - 60_000) })
        .where(eq(pipelineNode.id, lease.nodeId))
      const cycle = await scheduler.runCycle()
      assert.equal(cycle.offlineNodes, 1, '心跳超时节点应被置为离线')
      assert.equal(cycle.interruptedRuns, 1, '节点上的运行应被收口为 interrupted')
      const nodeRows = await context.app.db.select().from(pipelineNode).where(eq(pipelineNode.id, lease.nodeId))
      assert.equal(nodeRows[0]?.status, 'offline')
      const run = await runRow(context, lease.runId)
      assert.equal(run.status, 'interrupted')
      assert.ok(run.finished_at instanceof Date, '中断运行应记录结束时间')
      assert.equal(run.error_code, 'NODE_OFFLINE')
      const leaseRecord = await leaseRow(context, lease.leaseId)
      assert.equal(leaseRecord.status, 'expired', '节点失联后活动租约应置为 expired')
    })

    await t.test('租约过期：运行标记 interrupted，不自动改派', async () => {
      const lease = await prepareRunningLease(context)
      await context.app.db
        .update(pipelineLease)
        .set({ expires_at: new Date(Date.now() - 1_000) })
        .where(eq(pipelineLease.id, lease.leaseId))
      const cycle = await scheduler.runCycle()
      assert.equal(cycle.expiredLeases >= 1, true, '过期租约应被 Worker 处理')
      const run = await runRow(context, lease.runId)
      assert.equal(run.status, 'interrupted')
      assert.equal(run.error_code, 'LEASE_EXPIRED')
      const leaseRecord = await leaseRow(context, lease.leaseId)
      assert.equal(leaseRecord.status, 'expired')
    })

    await t.test('排队超时：无可用节点且超过运行超时的排队运行标记 failed', async () => {
      await offlineOtherNodes(context, [])
      const run = await triggerRun(context, context.developer, { idempotencyKey: `queue-timeout-${randomUUID()}` })
      await context.app.db
        .update(pipelineRun)
        .set({ created_at: new Date(Date.now() - 3_600_000) })
        .where(eq(pipelineRun.id, run.runId))
      const cycle = await scheduler.runCycle()
      assert.equal(cycle.timedOutRuns >= 1, true, '排队超时运行应被 Worker 收口')
      const detail = await getRunDetail(context, context.developer, run.runId)
      assert.equal(stringField(detail, 'status'), 'failed')
      assert.equal(stringField(detail, 'errorCode'), 'NODE_WAIT_TIMEOUT')
    })

    await t.test('管理员排空节点后不再分配新运行', async () => {
      const lease = await prepareRunningLease(context)
      const drain = await injectJson(context.app, 'POST', `/api/v1/pipeline-nodes/${lease.nodeId}/drain`, {
        cookie: context.admin.cookie,
      })
      assert.equal(drain.envelope.success, true, drain.body)
      const drained = asRecord(asRecord(drain.envelope.data, '排空响应').node, '节点视图')
      assert.equal(stringField(drained, 'status'), 'draining')
      const run = await triggerRun(context, context.developer, { idempotencyKey: `drain-${randomUUID()}` })
      await scheduler.runCycle()
      const queued = await getRunDetail(context, context.developer, run.runId)
      const assignedTo = typeof queued.nodeId === 'string' ? queued.nodeId : null
      assert.notEqual(assignedTo, lease.nodeId, 'draining 节点不应领取新任务')
      assert.equal(stringField(queued, 'status'), 'queued')
    })

    await t.test('并发调度不重复分配同一运行，且单节点分配不超过并发上限', async () => {
      const node = await startNode(context)
      await offlineOtherNodes(context, [node.nodeId])
      for (let index = 0; index < 3; index += 1) {
        await triggerRun(context, context.developer, { idempotencyKey: `concurrent-${index}-${randomUUID()}` })
      }
      await Promise.all([scheduler.runCycle(), scheduler.runCycle(), scheduler.runCycle()])
      const assignedRuns = await context.app.db
        .select()
        .from(pipelineRun)
        .where(and(eq(pipelineRun.node_id, node.nodeId), inArray(pipelineRun.status, ['assigned', 'running'])))
      assert.ok(assignedRuns.length <= 1, `单节点分配数不应超过并发上限 1，实际 ${assignedRuns.length}`)
      const list = await injectJson(
        context.app,
        'GET',
        `/api/v1/projects/${context.projectId}/pipeline-runs?workflowPath=${encodeURIComponent('.devops/workflows/ci.yml')}&pageSize=100`,
        { cookie: context.developer.cookie },
      )
      assert.equal(list.envelope.success, true, list.body)
      assert.ok(items(asRecord(list.envelope.data, '运行列表')).length >= 3)
    })
  },
)
