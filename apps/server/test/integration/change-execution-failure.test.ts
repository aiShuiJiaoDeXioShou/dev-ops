import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { changeExecution, changePlan } from '../../src/modules/operations/operations.tables.ts'
import { pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import { reconcileChangeExecutionFromRun } from '../../src/modules/operations/operations.execution.service.ts'
import { asRecord, expectSuccess, injectJson, setupPipelineContext, stringField } from '../helpers/operations.ts'

test('T071 取消执行中计划按实际状态返回外部影响', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app, projectId, admin, developer } = context
  const service = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/projects/${projectId}/services`, {
      cookie: admin.cookie,
      payload: { name: 'web' },
    }),
    '创建服务',
  )
  const serviceId = stringField(asRecord(service, 'service'), 'id')

  async function prepareExecutingPlan(versionLabel: string, executionStatus: string) {
    const created = expectSuccess(
      await injectJson(app, 'POST', `/api/v1/projects/${projectId}/change-plans`, {
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
      }),
      '创建计划',
    )
    const planId = stringField(asRecord(created.plan, 'plan'), 'id')
    expectSuccess(
      await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/approve`, {
        cookie: admin.cookie,
        payload: { expectedRevision: 1 },
      }),
      '放行计划',
    )
    const [row] = await context.app.db.select().from(changePlan).where(eq(changePlan.id, planId))
    assert.ok(row)
    const executionId = randomUUID()
    await context.app.db.insert(changeExecution).values({
      id: executionId,
      team_id: context.teamId,
      project_id: projectId,
      plan_id: planId,
      plan_revision: 1,
      attempt: 1,
      execution_mode: 'external_system',
      status: executionStatus,
      expected_version_label: versionLabel,
      created_by_user_id: admin.userId,
      started_at: new Date(),
    })
    await context.app.db
      .update(changePlan)
      .set({ status: 'executing', version: row.version + 1, active_execution_id: executionId })
      .where(eq(changePlan.id, planId))
    return planId
  }

  const executedPlan = await prepareExecutingPlan('v3.0.0', 'succeeded')
  const partial = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/change-plans/${executedPlan}/cancel`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1, reason: '执行已完成，取消计划' },
    }),
    '取消已执行计划',
  )
  assert.equal(partial.externalEffect, 'partial')

  const runningPlan = await prepareExecutingPlan('v3.0.1', 'running')
  const unknown = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/change-plans/${runningPlan}/cancel`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1, reason: '执行中无法确认外部影响' },
    }),
    '取消执行中计划',
  )
  assert.equal(unknown.externalEffect, 'unknown')
})

test('T066 Worker 收口回填执行尝试与计划状态', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const planId = randomUUID()
  const executionId = randomUUID()
  const runId = randomUUID()
  await context.app.db.insert(pipelineRun).values({
    id: runId,
    team_id: context.teamId,
    project_id: context.projectId,
    repository_id: context.repositoryId,
    workflow_path: '.devops/workflows/deploy-test.yml',
    workflow_name: 'deploy',
    git_ref: 'main',
    commit_sha: 'a'.repeat(40),
    inputs: {},
    run_plan: { runId, jobs: [], secretNames: [] },
    workflow_snapshot: 'name: deploy',
    workflow_hash: 'b'.repeat(64),
    status: 'succeeded',
    trigger_source: 'manual',
    initiator_channel: 'web',
    triggered_by_user_id: context.admin.userId,
    idempotency_key: `reconcile-exec-${runId}`,
    timeout_seconds: 600,
    finished_at: new Date(),
  })
  await context.app.db.insert(changePlan).values({
    id: planId,
    team_id: context.teamId,
    project_id: context.projectId,
    service_id: null,
    target_resource: 'web',
    environment: 'test',
    operation_kind: 'database_change',
    status: 'executing',
    version_label: 'v1.0.0',
    scope_summary: '测试',
    evidence: '测试',
    rollback_plan: '测试',
    execution_mode: 'platform_pipeline',
    workflow_path: '.devops/workflows/deploy-test.yml',
    pipeline_inputs: {},
    created_by_user_id: context.admin.userId,
  })
  await context.app.db.insert(changeExecution).values({
    id: executionId,
    team_id: context.teamId,
    project_id: context.projectId,
    plan_id: planId,
    plan_revision: 1,
    attempt: 1,
    execution_mode: 'platform_pipeline',
    status: 'running',
    pipeline_run_id: runId,
    expected_version_label: 'v1.0.0',
    created_by_user_id: context.admin.userId,
  })

  assert.equal(await reconcileChangeExecutionFromRun(context.app.db, runId), true)
  const [execution] = await context.app.db.select().from(changeExecution).where(eq(changeExecution.id, executionId))
  const [plan] = await context.app.db.select().from(changePlan).where(eq(changePlan.id, planId))
  assert.equal(execution?.status, 'succeeded')
  assert.equal(plan?.status, 'verifying')
  assert.equal(await reconcileChangeExecutionFromRun(context.app.db, runId), false)
})

const DEPLOY_WORKFLOW = `name: deploy-test
on:
  workflow_dispatch:
    inputs:
      environment:
        type: string
        default: test
      service:
        type: string
        default: web
      version:
        type: string
jobs:
  deploy:
    runs-on: linux
    steps:
      - uses: builtin:checkout
      - name: Deploy
        run: echo deploy
`

test('T071 核对后重试：失败计划创建新执行尝试', { timeout: 90_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app, projectId, admin, developer } = context
  context.git.setFile('.devops/workflows/deploy-test.yml', DEPLOY_WORKFLOW)
  const service = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/projects/${projectId}/services`, {
      cookie: admin.cookie,
      payload: { name: 'web' },
    }),
    '创建服务',
  )
  const serviceId = stringField(asRecord(service, 'service'), 'id')
  const created = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/projects/${projectId}/change-plans`, {
      cookie: developer.cookie,
      payload: {
        operationKind: 'deploy_version',
        environment: 'test',
        serviceId,
        targetResource: 'web',
        versionLabel: 'v4.0.0',
        scopeSummary: '部署测试环境',
        evidence: '流水线通过',
        rollbackPlan: '回滚上一版本',
        executionMode: 'platform_pipeline',
        workflowPath: '.devops/workflows/deploy-test.yml',
        workflowRef: 'main',
      },
    }),
    '创建计划',
  )
  const planId = stringField(asRecord(created.plan, 'plan'), 'id')
  expectSuccess(
    await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/approve`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1 },
    }),
    '放行计划',
  )
  const [plan] = await context.app.db.select().from(changePlan).where(eq(changePlan.id, planId))
  assert.ok(plan)
  await context.app.db.insert(changeExecution).values({
    id: randomUUID(),
    team_id: context.teamId,
    project_id: projectId,
    plan_id: planId,
    plan_revision: 1,
    attempt: 1,
    execution_mode: 'external_system',
    status: 'failed',
    pipeline_run_id: null,
    expected_version_label: 'v4.0.0',
    created_by_user_id: admin.userId,
    finished_at: new Date(),
  })
  await context.app.db
    .update(changePlan)
    .set({ status: 'failed', version: plan.version + 1 })
    .where(eq(changePlan.id, planId))

  const retried = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/retry`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1, reason: '已核对：上一次执行未生效' },
    }),
    '重试计划',
  )
  assert.equal(asRecord(retried.plan, 'plan').status, 'executing')
  const retriedExecution = asRecord(retried.execution, 'execution')
  assert.equal(retriedExecution.attempt, 2)
  const runId = stringField(retriedExecution, 'pipelineRunId')
  const [retryRun] = await context.app.db.select().from(pipelineRun).where(eq(pipelineRun.id, runId))
  assert.equal(retryRun?.secret_environment, 'test')

  const cancelled = expectSuccess(
    await injectJson(app, 'POST', `/api/v1/change-plans/${planId}/cancel`, {
      cookie: admin.cookie,
      payload: { expectedRevision: 1, reason: '验证取消联动停止运行' },
    }),
    '取消执行中计划',
  )
  assert.equal(cancelled.externalEffect, 'unknown')
  const [runAfterCancel] = await context.app.db.select().from(pipelineRun).where(eq(pipelineRun.id, runId))
  assert.equal(runAfterCancel?.status, 'cancelled')
})

test('T094 运行超时映射为执行 timed_out', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const planId = randomUUID()
  const executionId = randomUUID()
  const runId = randomUUID()
  await context.app.db.insert(changePlan).values({
    id: planId,
    team_id: context.teamId,
    project_id: context.projectId,
    service_id: null,
    target_resource: 'web',
    environment: 'test',
    operation_kind: 'database_change',
    status: 'executing',
    version_label: 'v9.9.9',
    scope_summary: '超时映射测试',
    evidence: '测试',
    rollback_plan: '回滚',
    execution_mode: 'platform_pipeline',
    workflow_path: '.devops/workflows/deploy-test.yml',
    pipeline_inputs: {},
    created_by_user_id: context.admin.userId,
  })
  await context.app.db.insert(changeExecution).values({
    id: executionId,
    team_id: context.teamId,
    project_id: context.projectId,
    plan_id: planId,
    plan_revision: 1,
    attempt: 1,
    execution_mode: 'platform_pipeline',
    status: 'running',
    pipeline_run_id: runId,
    expected_version_label: 'v9.9.9',
    created_by_user_id: context.admin.userId,
  })
  await context.app.db.insert(pipelineRun).values({
    id: runId,
    team_id: context.teamId,
    project_id: context.projectId,
    repository_id: context.repositoryId,
    workflow_path: '.devops/workflows/deploy-test.yml',
    workflow_name: 'deploy',
    git_ref: 'main',
    commit_sha: 'b'.repeat(40),
    inputs: {},
    run_plan: { runId, jobs: [], secretNames: [] },
    workflow_snapshot: 'name: deploy',
    workflow_hash: 'c'.repeat(64),
    status: 'failed',
    error_code: 'RUN_TIMEOUT',
    trigger_source: 'manual',
    initiator_channel: 'web',
    triggered_by_user_id: context.admin.userId,
    idempotency_key: `timeout-${runId}`,
    timeout_seconds: 600,
    finished_at: new Date(),
  })

  assert.equal(await reconcileChangeExecutionFromRun(context.app.db, runId), true)
  const [execution] = await context.app.db.select().from(changeExecution).where(eq(changeExecution.id, executionId))
  const [plan] = await context.app.db.select().from(changePlan).where(eq(changePlan.id, planId))
  assert.equal(execution?.status, 'timed_out')
  assert.equal(plan?.status, 'failed')
  assert.equal(plan?.error_code, 'RUN_TIMEOUT')
})
