import { randomUUID } from 'node:crypto'
import type { PipelineInputValue } from '@dev-ops/pipeline-protocol'
import type { Database } from '../../platform/database/client.ts'
import { eq } from 'drizzle-orm'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { requireTeamMember } from '../identity/identity.session.ts'
import { requirePlanManager } from './operations.access.ts'
import { changeExecution, changePlan } from './operations.tables.ts'
import {
  attachExecutionRun,
  findChangePlanById,
  findChangeExecutionById,
  findChangePlanEvents,
  findExecutionsByPlan,
  findLatestChangeExecution,
  insertChangeExecution,
  insertChangePlanEvent,
  transitionChangePlan,
  updateChangeExecution,
} from './operations.repository.ts'
import { toChangePlanView, toExecutionView, type ChangeExecutionView, type ChangePlanView } from './operations.view.ts'

/** 执行与验证依赖的流水线端口；由 bootstrap 注入，测试可替换。 */
export interface OperationsPipelinePort {
  triggerRun(
    actor: SessionUser,
    projectId: string,
    input: {
      workflowPath: string
      ref: string
      inputs: Record<string, PipelineInputValue>
      idempotencyKey: string
      initiatorChannel: 'web' | 'api'
      secretEnvironment?: 'development' | 'test' | 'production'
    },
  ): Promise<{ run: { runId: string }; created: boolean }>
  getInternalRunStatus(
    runId: string,
  ): Promise<{ status: string; finishedAt: string | null; errorCode: string | null } | null>
  readRunArtifact(
    actor: SessionUser,
    runId: string,
    name: string,
    maxBytes?: number,
  ): Promise<{ content: string } | null>
  cancelRun(
    actor: SessionUser,
    runId: string,
    reason?: string,
  ): Promise<{ run: { runId: string; status: string }; created: boolean }>
}

/** 执行与验证依赖的运行版本写入端口。 */
export interface OperationsDeliveryPort {
  applyDeploymentRunVersion(
    input: {
      teamId: string
      projectId: string
      serviceId: string
      environment: string
      versionLabel: string
      evidenceUrl: string | null
      reason: string
      actorUserId: string
    },
    executor?: unknown,
  ): Promise<unknown>
}

/** 执行计划输入。 */
export interface ExecuteChangePlanInput {
  expectedRevision: number
}

/** 验证输入；产物缺失时必须提供人工核对依据。 */
export interface VerifyChangePlanInput {
  expectedRevision: number
  note?: string | null
  actualVersionLabel?: string | null
  healthStatus?: 'ok' | 'failing' | 'unknown' | null
}

/** 执行结果视图。 */
export interface ExecuteChangePlanResult {
  plan: ChangePlanView
  execution: ChangeExecutionView
}

/** 验证结果视图。 */
export interface VerifyChangePlanResult {
  plan: ChangePlanView
  execution: ChangeExecutionView
  runVersionApplied: boolean
}

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])

function mapRunStatusToExecution(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'failed'
    case 'interrupted':
      return 'interrupted'
    case 'timed_out':
      return 'timed_out'
    default:
      return 'running'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseVerificationArtifact(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 创建变更执行与验证用例。
 * @param deps 数据库、流水线与运行版本写入端口。
 * @returns 执行、验证、执行记录与运行状态同步用例。
 */
export function createOperationsExecutionUseCases(deps: {
  db: Database
  pipeline: OperationsPipelinePort
  delivery: OperationsDeliveryPort
  appOrigin: string
}) {
  const { db, pipeline, delivery } = deps

  async function loadPlan(planId: string) {
    const row = await findChangePlanById(db, planId)
    if (!row) throw new ApiError(ERROR_CODES.CHANGE_PLAN_NOT_FOUND, '变更计划不存在')
    return row
  }

  /**
   * 将执行尝试与流水线运行的最终状态对齐；只在运行已收口时更新。
   * @param plan 计划行。
   * @param execution 执行尝试行。
   * @returns 最新执行尝试行。
   */
  async function syncExecution(
    plan: Awaited<ReturnType<typeof loadPlan>>,
    execution: Awaited<ReturnType<typeof findChangeExecutionById>>,
  ) {
    if (!execution || !execution.pipeline_run_id) return execution
    if (execution.status !== 'queued' && execution.status !== 'running' && execution.status !== 'succeeded') {
      return execution
    }
    const run = await pipeline.getInternalRunStatus(execution.pipeline_run_id)
    if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) return execution
    if (execution.status === 'succeeded' && run.status === 'succeeded') return execution
    const mapped = mapRunStatusToExecution(run.status)
    const now = new Date()
    const updated = await updateChangeExecution(db, execution.id, ['queued', 'running'], {
      status: mapped,
      finished_at: now,
      error_code: run.status === 'succeeded' ? null : (run.errorCode ?? 'EXECUTION_FAILED'),
      error_message: run.status === 'succeeded' ? null : '执行未成功结束，请核对实际状态',
    })
    const next = updated ?? (await findChangeExecutionById(db, execution.id))
    if (run.status === 'succeeded') {
      await transitionChangePlan(db, plan.id, plan.version, ['executing'], { status: 'verifying' })
    } else {
      await transitionChangePlan(db, plan.id, plan.version, ['executing'], {
        status: 'failed',
        active_execution_id: null,
        error_code: run.errorCode ?? 'EXECUTION_FAILED',
        error_message: '执行未成功结束，请核对实际状态',
      })
    }
    await insertChangePlanEvent(db, {
      id: randomUUID(),
      teamId: plan.team_id,
      projectId: plan.project_id,
      planId: plan.id,
      executionId: execution.id,
      eventType: 'execution_finished',
      actorUserId: plan.created_by_user_id,
      summary: run.status === 'succeeded' ? '部署执行成功，等待验证' : '部署执行失败',
      payload: { runStatus: run.status, errorCode: run.errorCode },
    })
    return next ?? execution
  }

  /**
   * 核对后重试失败的计划：记录核对结论，回到已批准并创建新的执行尝试。
   * @param actor 当前用户；须为管理员或项目负责人。
   * @param planId 计划标识。
   * @param input 修订号与核对结论（必须说明未生效/已修复）。
   * @returns 新的执行尝试。
   * @throws 状态不允许、已有生效执行或版本冲突时抛出业务错误。
   */
  async function retryPlan(
    actor: SessionUser,
    planId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<{ plan: ChangePlanView; execution: ChangeExecutionView }> {
    const plan = await loadPlan(planId)
    await requirePlanManager(db, actor, plan)
    if (plan.status !== 'failed') {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有失败的计划可以重试')
    }
    if (plan.revision !== input.expectedRevision) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被修改，请刷新后重试')
    }
    const reason = input.reason.trim()
    if (reason.length === 0 || reason.length > 1000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '重试原因必须在 1-1000 字符之间')
    }
    const latest = await findLatestChangeExecution(db, planId)
    if (latest?.status === 'succeeded') {
      throw new ApiError(ERROR_CODES.CHANGE_EXECUTION_CONFLICT, '执行已成功，请进入验证而不是重试')
    }
    await db.transaction(async (tx) => {
      const updated = await transitionChangePlan(tx, planId, plan.version, ['failed'], {
        status: 'approved',
        active_execution_id: null,
        error_code: null,
        error_message: null,
      })
      if (!updated) throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '计划状态已变化，请刷新后重试')
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId: plan.team_id,
        projectId: plan.project_id,
        planId,
        executionId: latest?.id ?? null,
        eventType: 'retry_requested',
        actorUserId: actor.id,
        summary: '核对后请求重试',
        payload: { reason, attempt: (latest?.attempt ?? 0) + 1 },
      })
    })
    const approved = await loadPlan(planId)
    const result = await executePlan(actor, planId, { expectedRevision: approved.revision })
    return { plan: result.plan, execution: result.execution }
  }

  /** 同步计划下所有进行中的执行尝试。 */
  async function syncPlanExecutions(actor: SessionUser, planId: string): Promise<void> {
    const plan = await loadPlan(planId)
    await requireTeamMember(db, actor.id, plan.team_id)
    const executions = await findExecutionsByPlan(db, planId)
    for (const execution of executions) {
      await syncExecution(plan, execution)
    }
  }

  /**
   * 执行已批准计划：创建执行尝试并触发部署工作流。
   * @throws 计划未批准、修订冲突、执行方式不支持或工作流缺失时抛出业务错误。
   */
  async function executePlan(
    actor: SessionUser,
    planId: string,
    input: ExecuteChangePlanInput,
  ): Promise<ExecuteChangePlanResult> {
    const plan = await loadPlan(planId)
    await requirePlanManager(db, actor, plan)
    if (plan.status !== 'approved') {
      throw new ApiError(ERROR_CODES.CHANGE_PLAN_APPROVAL_REQUIRED, '只有已批准的计划可以执行')
    }
    if (plan.revision !== input.expectedRevision) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被修改，请刷新后重试')
    }
    if (plan.execution_mode !== 'platform_pipeline') {
      throw new ApiError(ERROR_CODES.CHANGE_PLAN_TARGET_UNSUPPORTED, '本版只支持平台流水线执行方式')
    }
    if (!plan.workflow_path || !plan.workflow_ref) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '执行前必须指定部署工作流与分支或标签')
    }
    const executions = await findExecutionsByPlan(db, planId)
    const attempt = executions.length + 1
    const executionId = randomUUID()
    await db.transaction(async (tx) => {
      await insertChangeExecution(tx, {
        id: executionId,
        teamId: plan.team_id,
        projectId: plan.project_id,
        planId,
        planRevision: plan.revision,
        attempt,
        executionMode: plan.execution_mode,
        expectedVersionLabel: plan.version_label,
        createdByUserId: actor.id,
      })
      const updated = await transitionChangePlan(tx, planId, plan.version, ['approved'], {
        status: 'executing',
        active_execution_id: executionId,
        started_at: new Date(),
      })
      if (!updated) throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '计划状态已变化，请刷新后重试')
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId: plan.team_id,
        projectId: plan.project_id,
        planId,
        executionId,
        eventType: 'execution_started',
        actorUserId: actor.id,
        summary: '开始执行变更计划',
        payload: { attempt, workflowPath: plan.workflow_path, ref: plan.workflow_ref },
      })
    })

    let runId: string
    try {
      const triggered = await pipeline.triggerRun(actor, plan.project_id, {
        workflowPath: plan.workflow_path,
        ref: plan.workflow_ref,
        inputs: plan.pipeline_inputs as Record<string, PipelineInputValue>,
        idempotencyKey: `change-plan-${planId}-${attempt}`,
        initiatorChannel: 'web',
        secretEnvironment: plan.environment as 'development' | 'test' | 'production',
      })
      runId = triggered.run.runId
      await attachExecutionRun(db, executionId, runId)
      await updateChangeExecution(db, executionId, ['queued'], { status: 'running', started_at: new Date() })
    } catch (error) {
      // 触发失败时区分"等待配置"与可重试的触发失败，避免留下“执行中但无运行”。
      const code = error instanceof ApiError ? error.code : ERROR_CODES.PIPELINE_RUN_NOT_FOUND
      const waitingConfig = code === ERROR_CODES.PIPELINE_SECRET_UNAVAILABLE
      await updateChangeExecution(db, executionId, ['queued'], {
        status: 'failed',
        finished_at: new Date(),
        error_code: code,
        error_message: waitingConfig ? '等待配置：项目环境凭据缺失或授权失效' : '部署工作流触发失败',
      })
      await transitionChangePlan(db, planId, plan.version + 1, ['executing'], {
        status: waitingConfig ? 'failed' : 'approved',
        active_execution_id: null,
        started_at: null,
        ...(waitingConfig ? { error_code: code, error_message: '等待配置：项目环境凭据缺失或授权失效' } : {}),
      })
      await insertChangePlanEvent(db, {
        id: randomUUID(),
        teamId: plan.team_id,
        projectId: plan.project_id,
        planId,
        executionId,
        eventType: 'execution_finished',
        actorUserId: actor.id,
        summary: waitingConfig ? '等待配置后重试' : '部署工作流触发失败，已回退到已批准',
        payload: { errorCode: code, waitingConfig },
      })
      throw error
    }
    const execution = await findChangeExecutionById(db, executionId)
    if (!execution) throw new Error('执行尝试写入后读取失败')
    return { plan: await toChangePlanView(db, await loadPlan(planId)), execution: await toExecutionView(db, execution) }
  }

  /**
   * 验证执行结果：读取 `change-verification` 产物并比对健康与版本，通过后完成计划并更新运行版本。
   * @throws 产物缺失且无人工核对依据、健康或版本不一致时抛出 CHANGE_VERIFICATION_MISMATCH。
   */
  async function verifyPlan(
    actor: SessionUser,
    planId: string,
    input: VerifyChangePlanInput,
  ): Promise<VerifyChangePlanResult> {
    const plan = await loadPlan(planId)
    await requirePlanManager(db, actor, plan)
    const latest = await findLatestChangeExecution(db, planId)
    if (!latest) throw new ApiError(ERROR_CODES.CHANGE_EXECUTION_NOT_FOUND, '没有可验证的执行记录')
    await syncExecution(plan, latest)
    const refreshedPlan = await loadPlan(planId)
    if (refreshedPlan.status !== 'verifying') {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待验证的计划可以执行验证')
    }
    if (refreshedPlan.revision !== input.expectedRevision) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被修改，请刷新后重试')
    }
    const execution = await findChangeExecutionById(db, latest.id)
    if (!execution || execution.status !== 'succeeded' || execution.verification_status !== 'pending') {
      throw new ApiError(ERROR_CODES.CHANGE_EXECUTION_CONFLICT, '执行尚未成功结束或已验证')
    }
    let healthStatus: 'ok' | 'failing' | 'unknown' = input.healthStatus ?? 'unknown'
    let actualVersion = input.actualVersionLabel?.trim() ?? null
    let evidence: Record<string, unknown> = { source: 'manual' }
    if (execution.pipeline_run_id) {
      const artifact = await pipeline.readRunArtifact(actor, execution.pipeline_run_id, 'change-verification', 262_144)
      if (artifact) {
        const parsed = parseVerificationArtifact(artifact.content)
        if (parsed) {
          const artifactHealth = typeof parsed.health === 'string' ? parsed.health : 'unknown'
          const artifactVersion = typeof parsed.actualVersion === 'string' ? parsed.actualVersion : null
          healthStatus = artifactHealth === 'ok' || artifactHealth === 'failing' ? artifactHealth : 'unknown'
          actualVersion = artifactVersion
          evidence = { source: 'artifact', artifactName: 'change-verification', checkedAt: parsed.checkedAt ?? null }
        }
      }
    }
    const manualNote = input.note?.trim() ?? null
    const artifactAvailable = evidence.source === 'artifact'
    if (!artifactAvailable) {
      if (!manualNote || !actualVersion || !input.healthStatus) {
        throw new ApiError(ERROR_CODES.CHANGE_VERIFICATION_MISMATCH, '验证产物缺失，需填写实际版本、健康状态与核对说明')
      }
    }
    if (healthStatus !== 'ok' || actualVersion !== refreshedPlan.version_label) {
      throw new ApiError(ERROR_CODES.CHANGE_VERIFICATION_MISMATCH, '健康状态或实际版本与计划不一致')
    }
    const verifiedAt = new Date()
    await db.transaction(async (tx) => {
      const updated = await updateChangeExecution(tx, execution.id, ['succeeded'], {
        verification_status: 'passed',
        health_status: 'ok',
        actual_version_label: actualVersion,
        verification_evidence: evidence,
        verified_by_user_id: actor.id,
        verified_at: verifiedAt,
        verification_note: manualNote,
        status: 'unverified',
      })
      if (!updated) throw new ApiError(ERROR_CODES.CHANGE_EXECUTION_CONFLICT, '验证状态已变化，请刷新后重试')
      const planUpdated = await transitionChangePlan(tx, planId, refreshedPlan.version, ['verifying'], {
        status: 'completed',
        completed_at: verifiedAt,
      })
      if (!planUpdated) throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '计划状态已变化，请刷新后重试')
      if (refreshedPlan.service_id) {
        await delivery.applyDeploymentRunVersion(
          {
            teamId: refreshedPlan.team_id,
            projectId: refreshedPlan.project_id,
            serviceId: refreshedPlan.service_id,
            environment: refreshedPlan.environment,
            versionLabel: refreshedPlan.version_label,
            evidenceUrl: `${deps.appOrigin.replace(/\/+$/, '')}/operations/changes/${planId}`,
            reason: `变更计划 ${planId} 验证通过`,
            actorUserId: actor.id,
          },
          tx,
        )
      }
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId: refreshedPlan.team_id,
        projectId: refreshedPlan.project_id,
        planId,
        executionId: execution.id,
        eventType: 'completed',
        actorUserId: actor.id,
        summary: '验证通过，变更完成',
        payload: { actualVersion, healthStatus, note: manualNote },
      })
    })
    const finalExecution = await findChangeExecutionById(db, execution.id)
    if (!finalExecution) throw new Error('执行尝试写入后读取失败')
    return {
      plan: await toChangePlanView(db, await loadPlan(planId)),
      execution: await toExecutionView(db, finalExecution),
      runVersionApplied: refreshedPlan.service_id !== null,
    }
  }

  /** 列出计划的执行记录；同步进行中尝试的实际状态。 */
  async function listExecutions(actor: SessionUser, planId: string): Promise<ChangeExecutionView[]> {
    const plan = await loadPlan(planId)
    await requireTeamMember(db, actor.id, plan.team_id)
    const executions = await findExecutionsByPlan(db, planId)
    for (const execution of executions) {
      await syncExecution(plan, execution)
    }
    const refreshed = await findExecutionsByPlan(db, planId)
    return Promise.all(refreshed.map((row) => toExecutionView(db, row)))
  }

  /** 读取计划事件，供详情与审计使用。 */
  async function listEvents(actor: SessionUser, planId: string) {
    const plan = await loadPlan(planId)
    await requireTeamMember(db, actor.id, plan.team_id)
    return findChangePlanEvents(db, planId, 100)
  }

  return { executePlan, verifyPlan, retryPlan, listExecutions, listEvents, syncPlanExecutions }
}

export type OperationsExecutionUseCases = ReturnType<typeof createOperationsExecutionUseCases>

/**
 * 运行终态收口后对齐执行尝试与计划状态；由 Worker 在运行进入终态时调用。
 * @param db 数据库连接。
 * @param runId 流水线运行标识。
 * @returns 是否更新了执行尝试。
 * @remarks 只处理平台流水线执行方式；人工核对仍由 verify/retry 接口完成。
 */
export async function reconcileChangeExecutionFromRun(db: Database, runId: string): Promise<boolean> {
  const [execution] = await db.select().from(changeExecution).where(eq(changeExecution.pipeline_run_id, runId)).limit(1)
  if (!execution) return false
  if (execution.status !== 'queued' && execution.status !== 'running') return false
  const { findPipelineRunById } = await import('../pipeline/pipeline.repository.ts')
  const run = await findPipelineRunById(db, runId)
  if (!run) return false
  const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
  if (!terminal.has(run.status)) return false
  const mapped = run.status === 'succeeded' ? 'succeeded' : run.status === 'interrupted' ? 'interrupted' : 'failed'
  const updated = await updateChangeExecution(db, execution.id, ['queued', 'running'], {
    status: mapped,
    finished_at: run.finished_at ?? new Date(),
    error_code: mapped === 'succeeded' ? null : (run.error_code ?? 'EXECUTION_FAILED'),
    error_message: mapped === 'succeeded' ? null : '执行未成功结束，请核对实际状态',
  })
  if (!updated) return false
  const [plan] = await db.select().from(changePlan).where(eq(changePlan.id, execution.plan_id)).limit(1)
  if (!plan) return true
  if (mapped === 'succeeded') {
    await transitionChangePlan(db, plan.id, plan.version, ['executing'], { status: 'verifying' })
  } else {
    await transitionChangePlan(db, plan.id, plan.version, ['executing'], {
      status: 'failed',
      active_execution_id: null,
      error_code: run.error_code ?? 'EXECUTION_FAILED',
      error_message: '执行未成功结束，请核对实际状态',
    })
  }
  return true
}
