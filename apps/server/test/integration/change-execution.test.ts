import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { serviceRunVersion } from '../../src/modules/delivery/delivery.tables.ts'
import { changeExecution, changePlan } from '../../src/modules/operations/operations.tables.ts'
import {
  asRecord,
  expectFailure,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
} from '../helpers/operations.ts'

test('T064 验证：产物缺失需人工核对，通过后同事务更新运行版本', { timeout: 90_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app, projectId, admin, developer } = context

  const createdService = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/services`, {
    cookie: admin.cookie,
    payload: { name: 'web' },
  })
  const serviceId = stringField(asRecord(expectSuccess(createdService, '创建服务'), 'service'), 'id')

  const createPlan = async (versionLabel: string) =>
    injectJson(app, 'POST', `/api/v1/projects/${projectId}/change-plans`, {
      cookie: developer.cookie,
      payload: {
        operationKind: 'deploy_version',
        environment: 'test',
        serviceId,
        targetResource: 'web',
        versionLabel,
        scopeSummary: '部署测试环境',
        evidence: '流水线通过',
        rollbackPlan: '回滚上一版本',
        executionMode: 'platform_pipeline',
        workflowPath: '.devops/workflows/deploy-test.yml',
        workflowRef: 'main',
      },
    })

  async function prepareVerifyingPlan(versionLabel: string): Promise<{ planId: string; version: number }> {
    const created = expectSuccess(await createPlan(versionLabel), '创建计划')
    const planId = stringField(asRecord(created.plan, 'plan'), 'id')
    expectSuccess(
      await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/approve`, {
        cookie: admin.cookie,
        payload: { expectedRevision: 1 },
      }),
      '放行计划',
    )
    const executionId = randomUUID()
    await context.app.db.insert(changeExecution).values({
      id: executionId,
      team_id: context.teamId,
      project_id: projectId,
      plan_id: planId,
      plan_revision: 1,
      attempt: 1,
      execution_mode: 'external_system',
      status: 'succeeded',
      expected_version_label: versionLabel,
      created_by_user_id: admin.userId,
      finished_at: new Date(),
    })
    const [planRow] = await context.app.db.select().from(changePlan).where(eq(changePlan.id, planId))
    assert.ok(planRow)
    await context.app.db
      .update(changePlan)
      .set({ status: 'verifying', version: planRow.version + 1, active_execution_id: executionId })
      .where(eq(changePlan.id, planId))
    return { planId, version: planRow.version + 1 }
  }

  await t.test('版本不一致时拒绝，不更新运行版本', async () => {
    const { planId } = await prepareVerifyingPlan('v2.0.0')
    const mismatch = await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/verify`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1, note: '人工核对', actualVersionLabel: 'v1.9.9', healthStatus: 'ok' },
    })
    expectFailure(mismatch, 'CHANGE_VERIFICATION_MISMATCH', '版本不一致')
    const rows = await context.app.db
      .select()
      .from(serviceRunVersion)
      .where(eq(serviceRunVersion.project_id, projectId))
    assert.equal(rows.length, 0)
    // 释放活动目标位，避免影响同一服务 + 环境的下一场景。
    await context.app.db.update(changePlan).set({ status: 'failed' }).where(eq(changePlan.id, planId))
  })

  await t.test('人工核对通过后计划完成并更新运行版本', async () => {
    const { planId } = await prepareVerifyingPlan('v2.0.1')
    const verified = await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/verify`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1, note: '已人工核对版本与健康', actualVersionLabel: 'v2.0.1', healthStatus: 'ok' },
    })
    const result = expectSuccess(verified, '验证通过')
    assert.equal(asRecord(result.plan, 'plan').status, 'completed')
    assert.equal(result.runVersionApplied, true)
    const verifiedExecution = asRecord(result.execution, 'execution')
    assert.equal(asRecord(verifiedExecution.verificationEvidence, 'verificationEvidence').source, 'manual')

    const [versionRow] = await context.app.db
      .select()
      .from(serviceRunVersion)
      .where(eq(serviceRunVersion.service_id, serviceId))
    assert.equal(versionRow?.version_label, 'v2.0.1')
    assert.equal(versionRow?.source, 'deployment_receipt')
  })
})
