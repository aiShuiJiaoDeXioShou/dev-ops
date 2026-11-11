import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  asRecord,
  expectFailure,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
} from '../helpers/operations.ts'

const PLAN_PATH = (projectId: string) => `/api/v1/projects/${projectId}/change-plans`

function planBody(serviceId: string, versionLabel: string) {
  return {
    operationKind: 'deploy_version',
    environment: 'test',
    serviceId,
    targetResource: 'web',
    versionLabel,
    scopeSummary: `部署测试环境 ${versionLabel}，仅替换应用容器`,
    evidence: '流水线校验通过',
    rollbackPlan: '回滚到上一版本',
    executionMode: 'platform_pipeline',
    workflowPath: '.devops/workflows/deploy-test.yml',
    workflowRef: 'main',
  }
}

test('T052 变更计划：放行、修改失效、权限、并发与事件', { timeout: 120_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app, projectId, admin, developer, viewer, stranger } = context

  const createdService = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/services`, {
    cookie: admin.cookie,
    payload: { name: 'web' },
  })
  const service = asRecord(expectSuccess(createdService, '创建服务'), 'service')
  const serviceId = stringField(service, 'id')

  const createPlan = async (cookie: string, versionLabel: string) =>
    injectJson(app, 'POST', PLAN_PATH(projectId), { cookie, payload: planBody(serviceId, versionLabel) })

  const first = await createPlan(developer.cookie, 'v1.0.0')
  const firstDetail = expectSuccess(first, '创建计划')
  const firstPlan = asRecord(firstDetail.plan, 'plan')
  const firstPlanId = stringField(firstPlan, 'id')
  assert.equal(firstPlan.status, 'pending')
  assert.equal(firstPlan.revision, 1)

  await t.test('放行：开发者无权，管理员可放行，发起人不能自放行', async () => {
    const byDeveloper = await injectJson(app, 'POST', `/api/v1/change-plans/${firstPlanId}/approve`, {
      cookie: developer.cookie,
      payload: { expectedRevision: 1 },
    })
    expectFailure(byDeveloper, 'FORBIDDEN', '开发者放行')

    const byAdmin = await injectJson(app, 'POST', `/api/v1/change-plans/${firstPlanId}/approve`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1 },
    })
    const approved = expectSuccess(byAdmin, '管理员放行')
    assert.equal(asRecord(approved.plan, 'plan').status, 'approved')

    const selfPlan = await injectJson(app, 'POST', PLAN_PATH(projectId), {
      cookie: admin.cookie,
      payload: planBody(serviceId, 'v1.0.1'),
    })
    const selfPlanId = stringField(asRecord(expectSuccess(selfPlan, '管理员创建计划').plan, 'plan'), 'id')
    const selfApprove = await injectJson(app, 'POST', `/api/v1/change-plans/${selfPlanId}/approve`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1 },
    })
    expectFailure(selfApprove, 'SELF_APPROVAL_FORBIDDEN', '自放行')
  })

  await t.test('放行后修改计划：回到待确认、递增修订并使旧放行失效', async () => {
    const extraService = expectSuccess(
      await injectJson(app, 'POST', `/api/v1/projects/${projectId}/services`, {
        cookie: admin.cookie,
        payload: { name: 'api-edit' },
      }),
      '创建第二个服务',
    )
    const editServiceId = stringField(asRecord(extraService, 'service'), 'id')
    const created = expectSuccess(
      await injectJson(app, 'POST', PLAN_PATH(projectId), {
        cookie: developer.cookie,
        payload: planBody(editServiceId, 'v1.2.0'),
      }),
      '创建待修改计划',
    )
    const editableId = stringField(asRecord(created.plan, 'plan'), 'id')
    const approved = expectSuccess(
      await injectJson(app, 'POST', `/api/v1/change-plans/${editableId}/approve`, {
        cookie: admin.cookie,
        payload: { expectedRevision: 1 },
      }),
      '放行待修改计划',
    )
    const approvedVersion = asRecord(approved.plan, 'plan').version
    const updated = expectSuccess(
      await injectJson(app, 'POST', `/api/v1/change-plans/${editableId}/update`, {
        cookie: developer.cookie,
        payload: {
          ...planBody(editServiceId, 'v1.2.1'),
          expectedVersion: approvedVersion,
          expectedRevision: 1,
        },
      }),
      '修改已批准计划',
    )
    const updatedPlan = asRecord(updated.plan, 'plan')
    assert.equal(updatedPlan.status, 'pending')
    assert.equal(updatedPlan.revision, 2)
    assert.equal(updated.approval, null)

    const execute = await injectJson(app, 'POST', `/api/v1/change-plans/${editableId}/execute`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 2 },
    })
    expectFailure(execute, 'CHANGE_PLAN_APPROVAL_REQUIRED', '旧放行不可执行')
  })

  await t.test('浏览者可读、跨团队不可见、同目标并发批准冲突', async () => {
    const reader = await injectJson(app, 'GET', `/api/v1/change-plans/${firstPlanId}`, {
      cookie: viewer.cookie,
    })
    expectSuccess(reader, '浏览者读取')

    const outsider = await injectJson(app, 'GET', `/api/v1/change-plans/${firstPlanId}`, {
      cookie: stranger.cookie,
    })
    expectFailure(outsider, 'FORBIDDEN', '跨团队读取')

    const conflicting = await createPlan(developer.cookie, 'v1.0.3')
    const conflictingId = stringField(asRecord(expectSuccess(conflicting, '创建冲突计划').plan, 'plan'), 'id')
    const approveConflict = await injectJson(app, 'POST', `/api/v1/change-plans/${conflictingId}/approve`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1 },
    })
    expectFailure(approveConflict, 'CHANGE_PLAN_CONFLICT', '同目标并发批准')
  })

  await t.test('待确认修改：修订递增、旧放行失效、事件可读', async () => {
    const second = await createPlan(developer.cookie, 'v1.1.0')
    const secondId = stringField(asRecord(expectSuccess(second, '创建第二计划').plan, 'plan'), 'id')
    const update = await injectJson(app, 'POST', `/api/v1/change-plans/${secondId}/update`, {
      cookie: developer.cookie,
      payload: { ...planBody(serviceId, 'v1.1.1'), expectedVersion: 1, expectedRevision: 1 },
    })
    const updated = expectSuccess(update, '修改计划')
    const updatedPlan = asRecord(updated.plan, 'plan')
    assert.equal(updatedPlan.revision, 2)
    assert.equal(updatedPlan.status, 'pending')

    const events = await injectJson(app, 'GET', `/api/v1/change-plans/${secondId}/events`, {
      cookie: developer.cookie,
    })
    const eventPage = expectSuccess(events, '读取事件')
    const eventItems = eventPage.items
    assert.ok(Array.isArray(eventItems) && eventItems.length >= 2)
  })

  await t.test('列表：按状态筛选、浏览者可读、跨团队拒绝', async () => {
    const list = await injectJson(
      app,
      'GET',
      `/api/v1/teams/${context.teamId}/change-plans?status=pending&page=1&pageSize=10`,
      {
        cookie: viewer.cookie,
      },
    )
    const page = expectSuccess(list, '读取变更列表')
    assert.equal(typeof page.total, 'number')
    assert.ok(Array.isArray(page.items))

    const outsider = await injectJson(app, 'GET', `/api/v1/teams/${context.otherTeam.teamId}/change-plans`, {
      cookie: viewer.cookie,
    })
    expectFailure(outsider, 'FORBIDDEN', '跨团队列表')
  })

  await t.test('取消：原因必填，取消后不可执行', async () => {
    const cancel = await injectJson(app, 'POST', `/api/v1/change-plans/${firstPlanId}/cancel`, {
      cookie: developer.cookie,
      payload: { expectedRevision: 1, reason: '演示结束，取消计划' },
    })
    const cancelled = expectSuccess(cancel, '取消计划')
    assert.equal(cancelled.externalEffect, 'none')
    const execute = await injectJson(app, 'POST', `/api/v1/change-plans/${firstPlanId}/execute`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1 },
    })
    expectFailure(execute, 'CHANGE_PLAN_APPROVAL_REQUIRED', '执行已取消计划')
  })
})
