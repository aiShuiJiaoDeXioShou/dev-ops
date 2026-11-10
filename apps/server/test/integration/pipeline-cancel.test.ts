import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import { pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  asRecord,
  cancelQueuedRuns,
  completeLease,
  createPipelineSchedulerForTest,
  expectFailure,
  getRunDetail,
  heartbeat,
  injectJson,
  offlineOtherNodes,
  prepareRunningLease,
  renewLease,
  reportStepStatus,
  setupPipelineContext,
  startNode,
  stringField,
  triggerRun,
  uploadLogs,
} from './pipeline-harness.ts'

/** 读取运行行；不存在时抛错。 */
async function runRow(context: Awaited<ReturnType<typeof setupPipelineContext>>, runId: string) {
  const rows = await context.app.db.select().from(pipelineRun).where(eq(pipelineRun.id, runId))
  const row = rows[0]
  if (!row) throw new Error(`运行不存在：${runId}`)
  return row
}

/** 取消运行并返回响应；调用方自行断言状态。 */
async function cancelRun(
  context: Awaited<ReturnType<typeof setupPipelineContext>>,
  runId: string,
  cookie: string,
  reason = '测试取消',
) {
  return injectJson(context.app, 'POST', `/api/v1/pipeline-runs/${runId}/cancel`, {
    cookie,
    payload: { reason },
  })
}

test(
  'T076 取消与超时：queued/assigned/running 收口、权限、并发竞争、终态不可翻转与日志保留',
  { timeout: 240_000 },
  async (t) => {
    const context = await setupPipelineContext(t)
    const scheduler = createPipelineSchedulerForTest(context)

    await t.test('取消 queued 运行：直接 cancelled、记录请求人与原因、pending 步骤跳过、写活动记录', async () => {
      const run = await triggerRun(context, context.developer, { idempotencyKey: `cancel-queued-${randomUUID()}` })
      const response = await cancelRun(context, run.runId, context.developer.cookie, '需求变更')
      assert.equal(response.envelope.success, true, response.body)
      const data = asRecord(response.envelope.data, '取消响应')
      assert.equal(stringField(data, 'status'), 'cancelled')
      assert.ok(data.cancelRequestedAt !== null, '应记录取消请求时间')
      assert.equal(stringField(data, 'errorCode'), 'CANCELLED')
      const row = await runRow(context, run.runId)
      assert.ok(row.finished_at instanceof Date, '取消后应记录结束时间')
      assert.equal(row.cancel_requested_by_user_id, context.developer.userId, '数据库应记录取消人')
      assert.ok(row.cancel_requested_at instanceof Date, '数据库应记录取消时间')
      const detail = await getRunDetail(context, context.developer, run.runId)
      const steps = asRecord({ steps: detail.steps }, '步骤列表').steps
      assert.ok(Array.isArray(steps) && steps.length > 0)
      for (const step of steps) {
        assert.equal(stringField(asRecord(step, '步骤'), 'status'), 'skipped', '取消后 pending 步骤应跳过')
      }
      const activityRows = await context.app.db
        .select()
        .from(activity)
        .where(and(eq(activity.entity_type, 'pipeline_run'), eq(activity.entity_id, run.runId)))
      const cancelActivity = activityRows.find((row) => row.action === 'pipeline_run_cancelled')
      assert.ok(cancelActivity, '取消应写入活动记录')
      assert.equal(cancelActivity.reason, '需求变更')
      assert.equal(cancelActivity.actor_user_id, context.developer.userId)

      const secondCancel = await cancelRun(context, run.runId, context.developer.cookie)
      expectFailure(secondCancel, 'PIPELINE_STATE_CONFLICT', '终态再次取消')
    })

    await t.test('取消权限矩阵：浏览者/非成员/匿名拒绝，开发者与管理员允许', async () => {
      const viewerRun = await triggerRun(context, context.developer, {
        idempotencyKey: `cancel-viewer-${randomUUID()}`,
      })
      const viewerCancel = await cancelRun(context, viewerRun.runId, context.viewer.cookie)
      expectFailure(viewerCancel, 'FORBIDDEN', '浏览者取消')
      const strangerCancel = await cancelRun(context, viewerRun.runId, context.stranger.cookie)
      expectFailure(strangerCancel, 'FORBIDDEN', '非成员取消')
      const anonymousCancel = await injectJson(context.app, 'POST', `/api/v1/pipeline-runs/${viewerRun.runId}/cancel`, {
        payload: { reason: '匿名' },
      })
      expectFailure(anonymousCancel, 'UNAUTHENTICATED', '匿名取消')
      const adminRun = await triggerRun(context, context.developer, { idempotencyKey: `cancel-admin-${randomUUID()}` })
      const adminCancel = await cancelRun(context, adminRun.runId, context.admin.cookie)
      assert.equal(adminCancel.envelope.success, true, adminCancel.body)
      const missingRun = await cancelRun(context, randomUUID(), context.admin.cookie)
      expectFailure(missingRun, 'PIPELINE_RUN_NOT_FOUND', '取消不存在的运行')
    })

    await t.test('取消 assigned 运行：已分配未领取可直接收口为 cancelled', async () => {
      const node = await startNode(context)
      await offlineOtherNodes(context, [node.nodeId])
      await cancelQueuedRuns(context)
      const run = await triggerRun(context, context.developer, { idempotencyKey: `cancel-assigned-${randomUUID()}` })
      await scheduler.runCycle()
      const before = await getRunDetail(context, context.developer, run.runId)
      assert.equal(stringField(before, 'status'), 'assigned')
      const response = await cancelRun(context, run.runId, context.developer.cookie)
      assert.equal(response.envelope.success, true, response.body)
      assert.equal(stringField(asRecord(response.envelope.data, '取消响应'), 'status'), 'cancelled')
    })

    await t.test(
      '取消 running 运行：进入 cancelling、心跳下发 cancelLeaseIds、续约 cancelRequested=true、Agent 确认后 cancelled',
      async () => {
        const lease = await prepareRunningLease(context)
        await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, { status: 'running' })
        const cancelling = await cancelRun(context, lease.runId, context.developer.cookie)
        assert.equal(cancelling.envelope.success, true, cancelling.body)
        const cancellingData = asRecord(cancelling.envelope.data, '取消响应')
        assert.equal(stringField(cancellingData, 'status'), 'cancelling')

        const beat = await heartbeat(context, lease.agentToken, {
          version: '0.1.0',
          runningLeaseId: lease.leaseId,
        })
        const cancelLeaseIds = asRecord(beat, '心跳响应').cancelLeaseIds
        assert.ok(Array.isArray(cancelLeaseIds) && cancelLeaseIds.includes(lease.leaseId), '心跳应下发待取消租约')
        const renewed = await renewLease(context, lease.agentToken, lease.leaseId, lease.leaseToken)
        assert.equal(renewed.cancelRequested, true, '取消中租约续约应返回 cancelRequested=true')

        const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
          status: 'cancelled',
          errorCode: 'CANCELLED',
          errorMessage: '用户取消',
        })
        assert.equal(completed.envelope.success, true, completed.body)
        const detail = await getRunDetail(context, context.developer, lease.runId)
        assert.equal(stringField(detail, 'status'), 'cancelled')
      },
    )

    await t.test('取消后 Agent 误报成功不得翻转成功（终态竞争以平台取消为准）', async () => {
      const lease = await prepareRunningLease(context)
      await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, { status: 'running' })
      const cancelled = await cancelRun(context, lease.runId, context.developer.cookie)
      assert.equal(cancelled.envelope.success, true, cancelled.body)
      const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
        status: 'succeeded',
      })
      assert.equal(completed.envelope.success, true, completed.body)
      const completeData = asRecord(completed.envelope.data, '完成响应')
      assert.equal(stringField(completeData, 'status'), 'cancelled', '取消中的运行不得被上报为成功')
      const detail = await getRunDetail(context, context.developer, lease.runId)
      assert.equal(stringField(detail, 'status'), 'cancelled')
    })

    await t.test('运行级超时：Worker 下发 cancelling（RUN_TIMEOUT），Agent 上报 succeeded 最终为 failed', async () => {
      const lease = await prepareRunningLease(context)
      await context.app.db
        .update(pipelineRun)
        .set({ timeout_seconds: 1, started_at: new Date(Date.now() - 60_000) })
        .where(eq(pipelineRun.id, lease.runId))
      const cycle = await scheduler.runCycle()
      assert.equal(cycle.timedOutRuns >= 1, true, 'Worker 应处理运行级超时')
      const detail = await getRunDetail(context, context.developer, lease.runId)
      assert.equal(stringField(detail, 'status'), 'cancelling')
      assert.equal(stringField(detail, 'errorCode'), 'RUN_TIMEOUT')
      const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
        status: 'succeeded',
      })
      assert.equal(completed.envelope.success, true, completed.body)
      const afterDetail = await getRunDetail(context, context.developer, lease.runId)
      assert.equal(stringField(afterDetail, 'status'), 'failed', '超时运行不得显示成功')
    })

    await t.test('并发取消与终态竞争：同一 queued 运行只允许一次成功状态迁移，终态保持 cancelled', async () => {
      const run = await triggerRun(context, context.developer, { idempotencyKey: `cancel-race-${randomUUID()}` })
      const responses = await Promise.all([
        cancelRun(context, run.runId, context.developer.cookie, '并发取消 A'),
        cancelRun(context, run.runId, context.developer.cookie, '并发取消 B'),
      ])
      const successCount = responses.filter((response) => response.envelope.success).length
      const conflictCount = responses.filter((response) => response.envelope.code === 'PIPELINE_STATE_CONFLICT').length
      assert.equal(successCount, 1, `并发取消只应一次成功，实际 ${successCount}`)
      assert.equal(conflictCount, 1, `另一次应以 PIPELINE_STATE_CONFLICT 拒绝，实际 ${conflictCount}`)
      const detail = await getRunDetail(context, context.developer, run.runId)
      assert.equal(stringField(detail, 'status'), 'cancelled')

      const lease = await prepareRunningLease(context)
      await reportStepStatus(context, lease.agentToken, lease.leaseId, lease.leaseToken, 0, { status: 'running' })
      const cancelFirst = await cancelRun(context, lease.runId, context.developer.cookie)
      assert.equal(cancelFirst.envelope.success, true, cancelFirst.body)
      const lateSucceeded = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
        status: 'succeeded',
      })
      assert.equal(lateSucceeded.envelope.success, true, lateSucceeded.body)
      const finalCancel = await cancelRun(context, lease.runId, context.developer.cookie)
      expectFailure(finalCancel, 'PIPELINE_STATE_CONFLICT', '终态后再次取消')
    })

    await t.test('取消/中断后已有日志仍可读取（保留已产生数据）', async () => {
      const lease = await prepareRunningLease(context)
      const logs = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
        { stepIndex: 1, seq: 1, content: 'before-cancel\n' },
      ])
      assert.equal(logs.envelope.success, true, logs.body)
      const cancelled = await cancelRun(context, lease.runId, context.developer.cookie)
      assert.equal(cancelled.envelope.success, true, cancelled.body)
      await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, { status: 'cancelled' })
      const readBack = await injectJson(
        context.app,
        'GET',
        `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1&afterSeq=0`,
        { cookie: context.viewer.cookie },
      )
      assert.equal(readBack.envelope.success, true, readBack.body)
      const logData = asRecord(readBack.envelope.data, '日志 data')
      const logItems = logData.items
      assert.ok(Array.isArray(logItems) && logItems.length === 1, '取消后已上传日志应保留可读')
    })
  },
)
