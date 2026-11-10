import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  asRecord,
  completeLease,
  expectSuccess,
  getRunDetail,
  injectJson,
  prepareRunningLease,
  setupPipelineContext,
  stringField,
} from './pipeline-harness.ts'

test('取消与失败收口的 errorMessage：有原因返回脱敏原因，无原因返回 null 而非空字符串', async (t) => {
  const context = await setupPipelineContext(t)

  await t.test('带原因取消：详情保留取消原因，Agent 无说明完成时不覆盖为空白', async () => {
    const lease = await prepareRunningLease(context)
    const cancelled = await injectJson(context.app, 'POST', `/api/v1/pipeline-runs/${lease.runId}/cancel`, {
      cookie: context.developer.cookie,
      payload: { reason: '  现场取消原因  ' },
    })
    const cancelledData = expectSuccess(cancelled, '取消运行')
    assert.equal(stringField(cancelledData, 'status'), 'cancelling')
    assert.equal(stringField(cancelledData, 'errorCode'), 'CANCELLED')
    assert.equal(cancelledData.errorMessage, '现场取消原因')

    const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
      status: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: null,
    })
    expectSuccess(completed, 'Agent 确认取消')
    const detail = await getRunDetail(context, context.developer, lease.runId)
    assert.equal(stringField(detail, 'status'), 'cancelled')
    assert.equal(stringField(detail, 'errorCode'), 'CANCELLED')
    assert.equal(detail.errorMessage, '现场取消原因')
    assert.notEqual(detail.errorMessage, '')
  })

  await t.test('无原因取消：errorMessage 为 null，完成后仍为 null', async () => {
    const lease = await prepareRunningLease(context)
    const cancelled = await injectJson(context.app, 'POST', `/api/v1/pipeline-runs/${lease.runId}/cancel`, {
      cookie: context.developer.cookie,
      payload: {},
    })
    const cancelledData = expectSuccess(cancelled, '取消运行')
    assert.equal(cancelledData.errorMessage, null)

    const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
      status: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: '',
    })
    expectSuccess(completed, 'Agent 确认取消')
    const detail = await getRunDetail(context, context.developer, lease.runId)
    assert.equal(stringField(detail, 'status'), 'cancelled')
    assert.equal(detail.errorMessage, null)
  })

  await t.test('失败收口：Agent 未提供说明时 errorMessage 为 null', async () => {
    const lease = await prepareRunningLease(context)
    const completed = await completeLease(context, lease.agentToken, lease.leaseId, lease.leaseToken, {
      status: 'failed',
      errorCode: 'COMMAND_FAILED',
      errorMessage: null,
    })
    expectSuccess(completed, 'Agent 上报失败')
    const detail = await getRunDetail(context, context.developer, lease.runId)
    assert.equal(stringField(detail, 'status'), 'failed')
    assert.equal(stringField(detail, 'errorCode'), 'COMMAND_FAILED')
    assert.equal(detail.errorMessage, null)
    const failure = asRecord(detail, '运行详情')
    assert.notEqual(failure.errorMessage, '')
  })
})
