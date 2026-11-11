import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { ApiError } from '../../src/platform/http/errors.ts'
import { ERROR_CODES } from '../../src/platform/http/error-codes.ts'
import { createOperationsService } from '../../src/modules/operations/operations.service.ts'
import { changePlan } from '../../src/modules/operations/operations.tables.ts'
import { setupPipelineContext } from '../helpers/operations.ts'

test('T091 凭据不可用时计划进入等待配置并可重试', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const db = context.app.db
  const service = expectService()
  const developer = { id: context.developer.userId, name: '开发者', email: 'dev@example.test' }
  const admin = { id: context.admin.userId, name: '管理员', email: 'admin@example.test' }
  const createdService = await service.createPlan(developer, context.projectId, {
    operationKind: 'deploy_version',
    environment: 'test',
    serviceId: (await createService()).id,
    targetResource: 'web',
    versionLabel: 'v9.0.0',
    scopeSummary: '部署测试环境',
    evidence: '证据',
    rollbackPlan: '回滚',
    executionMode: 'platform_pipeline',
    workflowPath: '.devops/workflows/deploy-test.yml',
    workflowRef: 'main',
  })
  await service.approvePlan(admin, createdService.plan.id, { expectedRevision: 1 })
  await assert.rejects(
    () =>
      service.executePlan(admin, createdService.plan.id, {
        expectedRevision: 1,
      }),
    (error: unknown) => error instanceof ApiError && error.code === ERROR_CODES.PIPELINE_SECRET_UNAVAILABLE,
  )
  const [plan] = await db.select().from(changePlan).where(eq(changePlan.id, createdService.plan.id))
  assert.equal(plan?.status, 'failed')
  assert.equal(plan?.error_code, ERROR_CODES.PIPELINE_SECRET_UNAVAILABLE)

  async function createService() {
    const { randomUUID } = await import('node:crypto')
    const { projectService } = await import('../../src/modules/projects/projects.tables.ts')
    const id = randomUUID()
    await db.insert(projectService).values({
      id,
      team_id: context.teamId,
      project_id: context.projectId,
      name: 'web-waiting',
      status: 'active',
      created_by_user_id: admin.id,
    })
    return { id }
  }

  function expectService() {
    return createOperationsService({
      db,
      pipeline: {
        async triggerRun() {
          throw new ApiError(ERROR_CODES.PIPELINE_SECRET_UNAVAILABLE, '运行时密钥不可用')
        },
        async getInternalRunStatus() {
          return null
        },
        async readRunArtifact() {
          return null
        },
        async cancelRun() {
          throw new Error('not used')
        },
      },
      delivery: {
        async applyDeploymentRunVersion() {
          throw new Error('not used')
        },
      },
      appOrigin: 'http://localhost:5173',
    })
  }
})
