import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { findProjectById } from '../projects/projects.repository.ts'
import {
  assertNotSelfApproval,
  requirePlanCanceller,
  requirePlanEditor,
  requirePlanManager,
} from './operations.access.ts'
import {
  findChangePlanById,
  findChangePlanEvents,
  findChangePlans,
  findExecutionsByPlan,
  findChangePlanEventsPage,
  findLatestChangeExecution,
  findLatestValidApproval,
  insertChangePlan,
  insertChangePlanApproval,
  insertChangePlanEvent,
  invalidatePlanApprovals,
  transitionChangePlan,
  updateChangePlanContent,
  type ChangePlanUpdateFields,
} from './operations.repository.ts'
import { assertPlanTransition, isPlanEditable } from './operations.state.ts'
import {
  createOperationsExecutionUseCases,
  type OperationsDeliveryPort,
  type OperationsPipelinePort,
} from './operations.execution.service.ts'
import type { ChangePlanStatus } from './operations.state.ts'
import {
  toChangePlanEventView,
  toChangePlanView,
  toChangePlanViews,
  toExecutionView,
  type ChangePlanActions,
  type ChangePlanEventView,
  type ChangePlanView,
  type ChangeExecutionView,
} from './operations.view.ts'

const ENVIRONMENTS = ['development', 'test', 'production'] as const
const OPERATION_KINDS = ['deploy_version', 'database_change', 'server_cleanup', 'cloud_resource_change'] as const
const EXECUTION_MODES = ['platform_pipeline', 'external_system'] as const

/** 创建计划输入；部署类必须提供服务与工作流。 */
export interface CreateChangePlanInput {
  operationKind: string
  environment: string
  serviceId?: string | null
  targetResource: string
  versionLabel: string
  scopeSummary: string
  evidence: string
  rollbackPlan: string
  executionMode: string
  workflowPath?: string | null
  workflowRef?: string | null
}

/** 修改计划输入；expectedVersion/expectedRevision 必须与当前值一致。 */
export interface UpdateChangePlanInput extends CreateChangePlanInput {
  expectedVersion: number
  expectedRevision: number
}

/** 放行输入。 */
export interface ApproveChangePlanInput {
  expectedRevision: number
  note?: string | null
}

/** 取消输入。 */
export interface CancelChangePlanInput {
  expectedRevision: number
  reason: string
}

/** 计划详情视图。 */
export interface ChangePlanDetailView {
  plan: ChangePlanView
  approval: {
    id: string
    revision: number
    approvedBy: ChangePlanView['approvedBy']
    approvedAt: string
    invalidatedAt: string | null
  } | null
  executions: ChangeExecutionView[]
  events: ChangePlanEventView[]
  actions: ChangePlanActions
}

/** 列表查询。 */
export interface ChangePlanListQuery {
  projectId?: string
  environment?: string
  status?: string
  operationKind?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

interface ValidatedPlanFields {
  operationKind: string
  environment: string
  serviceId: string | null
  targetResource: string
  versionLabel: string
  scopeSummary: string
  evidence: string
  rollbackPlan: string
  executionMode: string
  workflowPath: string | null
  workflowRef: string | null
}

function requireText(value: string | null | undefined, label: string, max: number): string {
  const text = (value ?? '').trim()
  if (text.length === 0) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${label}不能为空`)
  if (text.length > max) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${label}不能超过 ${max} 字符`)
  return text
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${label}不合法`)
  }
  return value as T
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').trim()
  if (text.length === 0) return null
  if (text.length > max) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `字段不能超过 ${max} 字符`)
  return text
}

function validateInput(input: CreateChangePlanInput): ValidatedPlanFields {
  const operationKind = requireEnum(input.operationKind, OPERATION_KINDS, '操作类型')
  const environment = requireEnum(input.environment, ENVIRONMENTS, '目标环境')
  const executionMode = requireEnum(input.executionMode, EXECUTION_MODES, '执行方式')
  const serviceId = optionalText(input.serviceId ?? null, 36)
  const workflowPath = optionalText(input.workflowPath ?? null, 500)
  if (operationKind === 'deploy_version') {
    if (!serviceId) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '部署计划必须指定服务')
    if (!workflowPath) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '部署计划必须指定部署工作流')
  } else if (serviceId) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '非部署计划不能指定服务')
  }
  return {
    operationKind,
    environment,
    serviceId,
    targetResource: requireText(input.targetResource, '目标资源', 200),
    versionLabel: requireText(input.versionLabel, '版本标识', 200),
    scopeSummary: requireText(input.scopeSummary, '变更范围', 2000),
    evidence: requireText(input.evidence, '核对依据', 1000),
    rollbackPlan: requireText(input.rollbackPlan, '恢复方案', 1000),
    executionMode,
    workflowPath,
    workflowRef: optionalText(input.workflowRef ?? null, 200),
  }
}

/**
 * 创建变更计划服务。
 * @param deps 数据库连接。
 * @returns 计划创建、查询、修改、放行与取消用例。
 * @remarks 计划是团队级对象；执行与验证用例在后续阶段接入。
 */
export function createOperationsService(deps: {
  db: Database
  pipeline: OperationsPipelinePort
  delivery: OperationsDeliveryPort
  appOrigin: string
}) {
  const { db } = deps
  const execution = createOperationsExecutionUseCases({
    db,
    pipeline: deps.pipeline,
    delivery: deps.delivery,
    appOrigin: deps.appOrigin,
  })

  async function requireProjectWriter(actor: SessionUser, projectId: string): Promise<string> {
    const context = await getProjectContext(db, projectId)
    if (!context) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, context.teamId, ['admin', 'developer'])
    return context.teamId
  }

  async function loadPlanOrThrow(planId: string) {
    const row = await findChangePlanById(db, planId)
    if (!row) throw new ApiError(ERROR_CODES.CHANGE_PLAN_NOT_FOUND, '变更计划不存在')
    return row
  }

  async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
    const projectRow = await findProjectById(db, projectId)
    return projectRow?.owner_user_id === userId
  }

  async function buildActions(
    actor: SessionUser,
    plan: Awaited<ReturnType<typeof loadPlanOrThrow>>,
  ): Promise<ChangePlanActions> {
    const member = await requireTeamMember(db, actor.id, plan.team_id)
    const isManager = member.role === 'admin' || (await isProjectOwner(plan.project_id, actor.id))
    const isCreator = plan.created_by_user_id === actor.id
    const status = plan.status
    return {
      canUpdate: status === 'pending' && (isCreator || isManager),
      canApprove: status === 'pending' && isManager && !isCreator,
      canExecute: status === 'approved' && isManager,
      canVerify: status === 'verifying' && isManager,
      canCancel: ['pending', 'approved', 'executing'].includes(status) && (isCreator || isManager),
      canRetry: status === 'failed' && isManager,
    }
  }

  async function detailView(
    actor: SessionUser,
    plan: Awaited<ReturnType<typeof loadPlanOrThrow>>,
  ): Promise<ChangePlanDetailView> {
    await execution.syncPlanExecutions(actor, plan.id)
    const [view, executions, events, approvalRow] = await Promise.all([
      toChangePlanView(db, plan),
      findExecutionsByPlan(db, plan.id),
      findChangePlanEvents(db, plan.id, 50),
      findLatestValidApproval(db, plan.id),
    ])
    return {
      plan: view,
      approval: approvalRow
        ? {
            id: approvalRow.id,
            revision: approvalRow.plan_revision,
            approvedBy: view.approvedBy,
            approvedAt: approvalRow.approved_at.toISOString(),
            invalidatedAt: approvalRow.invalidated_at === null ? null : approvalRow.invalidated_at.toISOString(),
          }
        : null,
      executions: await Promise.all(executions.map((row) => toExecutionView(db, row))),
      events: await Promise.all(events.map((row) => toChangePlanEventView(db, row))),
      actions: await buildActions(actor, plan),
    }
  }

  function snapshotOf(plan: Awaited<ReturnType<typeof loadPlanOrThrow>>): Record<string, unknown> {
    return {
      revision: plan.revision,
      operationKind: plan.operation_kind,
      environment: plan.environment,
      serviceId: plan.service_id,
      targetResource: plan.target_resource,
      versionLabel: plan.version_label,
      scopeSummary: plan.scope_summary,
      evidence: plan.evidence,
      rollbackPlan: plan.rollback_plan,
      executionMode: plan.execution_mode,
      workflowPath: plan.workflow_path,
      workflowRef: plan.workflow_ref,
    }
  }

  /** 创建变更计划。 */
  async function createPlan(
    actor: SessionUser,
    projectId: string,
    input: CreateChangePlanInput,
  ): Promise<ChangePlanDetailView> {
    const teamId = await requireProjectWriter(actor, projectId)
    const fields = validateInput(input)
    const planId = randomUUID()
    await db.transaction(async (tx) => {
      await insertChangePlan(tx, {
        id: planId,
        teamId,
        projectId,
        serviceId: fields.serviceId,
        targetResource: fields.targetResource,
        environment: fields.environment,
        operationKind: fields.operationKind,
        status: 'pending',
        versionLabel: fields.versionLabel,
        scopeSummary: fields.scopeSummary,
        evidence: fields.evidence,
        rollbackPlan: fields.rollbackPlan,
        executionMode: fields.executionMode,
        workflowPath: fields.workflowPath,
        workflowRef: fields.workflowRef,
        pipelineInputs: {
          environment: fields.environment,
          ...(fields.serviceId ? { service: fields.serviceId } : {}),
          version: fields.versionLabel,
        },
        createdByUserId: actor.id,
      })
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId,
        projectId,
        planId,
        eventType: 'created',
        actorUserId: actor.id,
        summary: '创建了变更计划',
        payload: { revision: 1, environment: fields.environment, versionLabel: fields.versionLabel },
      })
    })
    return detailView(actor, await loadPlanOrThrow(planId))
  }

  /** 列出团队变更计划；浏览者可读。 */
  async function listPlans(
    actor: SessionUser,
    teamId: string,
    query: ChangePlanListQuery,
  ): Promise<{ items: ChangePlanView[]; page: number; pageSize: number; total: number }> {
    await requireTeamMember(db, actor.id, teamId)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    validatePage(page, pageSize)
    const filters = {
      projectId: query.projectId,
      environment: query.environment,
      status: query.status,
      operationKind: query.operationKind,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }
    const { rows, total } = await findChangePlans(db, teamId, filters, {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    })
    return { items: await toChangePlanViews(db, rows), page, pageSize, total }
  }

  /** 读取计划详情；非团队成员不可见。 */
  async function getPlan(actor: SessionUser, planId: string): Promise<ChangePlanDetailView> {
    const row = await loadPlanOrThrow(planId)
    await requireTeamMember(db, actor.id, row.team_id)
    return detailView(actor, row)
  }

  /** 修改待确认计划；实质字段变化递增修订并作废旧放行。 */
  async function updatePlan(
    actor: SessionUser,
    planId: string,
    input: UpdateChangePlanInput,
  ): Promise<ChangePlanDetailView> {
    const row = await loadPlanOrThrow(planId)
    await requirePlanEditor(db, actor, row)
    const wasApproved = row.status === 'approved'
    if (!isPlanEditable(row.status as ChangePlanStatus) && !wasApproved) {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待确认或已批准的计划可以修改')
    }
    if (row.revision !== input.expectedRevision) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被修改，请刷新后重试')
    }
    const validated = validateInput(input)
    const updateFields: ChangePlanUpdateFields = {
      ...validated,
      pipelineInputs: {
        environment: validated.environment,
        ...(validated.serviceId ? { service: validated.serviceId } : {}),
        version: validated.versionLabel,
      },
    }
    await db.transaction(async (tx) => {
      const updated = await updateChangePlanContent(tx, planId, input.expectedVersion, updateFields)
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被其他操作修改，请刷新后重试')
      if (wasApproved) {
        const reverted = await transitionChangePlan(tx, planId, input.expectedVersion, ['approved'], {
          status: 'pending',
          approved_by_user_id: null,
          approved_at: null,
          approved_revision: null,
          active_execution_id: null,
        })
        if (!reverted) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被其他操作修改，请刷新后重试')
      }
      await invalidatePlanApprovals(tx, planId, '计划内容已修改，放行失效')
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId: row.team_id,
        projectId: row.project_id,
        planId,
        eventType: 'approval_invalidated',
        actorUserId: actor.id,
        summary: wasApproved ? '已批准计划被修改，放行失效并回到待确认' : '计划修改，旧放行失效',
        payload: { previousRevision: row.revision, newRevision: row.revision + 1 },
      })
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId: row.team_id,
        projectId: row.project_id,
        planId,
        eventType: 'updated',
        actorUserId: actor.id,
        summary: '修改了变更计划',
        payload: {
          previousRevision: row.revision,
          newRevision: row.revision + 1,
          versionLabel: updateFields.versionLabel,
        },
      })
    })
    return detailView(actor, await loadPlanOrThrow(planId))
  }

  /** 放行计划；绑定修订与内容快照，发起人不能放行自己的计划。 */
  async function approvePlan(
    actor: SessionUser,
    planId: string,
    input: ApproveChangePlanInput,
  ): Promise<ChangePlanDetailView> {
    const row = await loadPlanOrThrow(planId)
    await requirePlanManager(db, actor, row)
    assertNotSelfApproval(actor.id, row)
    if (row.status !== 'pending') {
      throw new ApiError(ERROR_CODES.CHANGE_PLAN_APPROVAL_REQUIRED, '只有待确认的计划可以放行')
    }
    if (row.revision !== input.expectedRevision) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被修改，请刷新后重试')
    }
    const approvedAt = new Date()
    try {
      await db.transaction(async (tx) => {
        const updated = await transitionChangePlan(tx, planId, row.version, ['pending'], {
          status: 'approved',
          approved_by_user_id: actor.id,
          approved_at: approvedAt,
          approved_revision: row.revision,
        })
        if (!updated) throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '计划状态已变化，请刷新后重试')
        await insertChangePlanApproval(tx, {
          id: randomUUID(),
          teamId: row.team_id,
          projectId: row.project_id,
          planId,
          planRevision: row.revision,
          planSnapshot: snapshotOf(row),
          approvedByUserId: actor.id,
          approvedAt,
        })
        await insertChangePlanEvent(tx, {
          id: randomUUID(),
          teamId: row.team_id,
          projectId: row.project_id,
          planId,
          eventType: 'approved',
          actorUserId: actor.id,
          summary: '放行了变更计划',
          payload: { revision: row.revision, note: input.note ?? null },
        })
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.CHANGE_PLAN_CONFLICT, '同一服务与环境已有进行中的变更计划')
      }
      throw error
    }
    return detailView(actor, await loadPlanOrThrow(planId))
  }

  /** 取消计划；执行中取消返回实际外部影响。 */
  async function cancelPlan(
    actor: SessionUser,
    planId: string,
    input: CancelChangePlanInput,
  ): Promise<{ plan: ChangePlanView; externalEffect: 'none' | 'partial' | 'unknown' }> {
    const row = await loadPlanOrThrow(planId)
    await requirePlanCanceller(db, actor, row)
    if (row.revision !== input.expectedRevision) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '计划已被修改，请刷新后重试')
    }
    assertPlanTransition(row.status as ChangePlanStatus, 'cancelled')
    const reason = requireText(input.reason, '取消原因', 1000)
    let externalEffect: 'none' | 'partial' | 'unknown' = 'none'
    if (row.status === 'executing') {
      const latest = await findLatestChangeExecution(db, planId)
      if (!latest) externalEffect = 'none'
      else if (latest.status === 'succeeded' || latest.status === 'unverified') externalEffect = 'partial'
      else externalEffect = 'unknown'
      if (latest?.pipeline_run_id) {
        try {
          await deps.pipeline.cancelRun(actor, latest.pipeline_run_id, `变更计划取消：${reason}`)
        } catch (error) {
          const code = error instanceof ApiError ? error.code : undefined
          if (code !== ERROR_CODES.PIPELINE_STATE_CONFLICT && code !== ERROR_CODES.PIPELINE_RUN_NOT_FOUND) throw error
        }
      }
    }
    await db.transaction(async (tx) => {
      const updated = await transitionChangePlan(tx, planId, row.version, ['pending', 'approved', 'executing'], {
        status: 'cancelled',
        completed_at: new Date(),
      })
      if (!updated) throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '计划状态已变化，请刷新后重试')
      await invalidatePlanApprovals(tx, planId, '计划已取消')
      await insertChangePlanEvent(tx, {
        id: randomUUID(),
        teamId: row.team_id,
        projectId: row.project_id,
        planId,
        eventType: 'cancelled',
        actorUserId: actor.id,
        summary: '取消了变更计划',
        payload: { reason, externalEffect },
      })
    })
    return { plan: await toChangePlanView(db, await loadPlanOrThrow(planId)), externalEffect }
  }

  /**
   * 分页读取计划事件；团队成员可读，事件不可编辑。
   * @returns 事件视图与分页信息。
   */
  async function listEventsPage(
    actor: SessionUser,
    planId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<{ items: ChangePlanEventView[]; page: number; pageSize: number; total: number }> {
    const row = await loadPlanOrThrow(planId)
    await requireTeamMember(db, actor.id, row.team_id)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    validatePage(page, pageSize)
    const result = await findChangePlanEventsPage(db, planId, {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    })
    return {
      items: await Promise.all(result.rows.map((event) => toChangePlanEventView(db, event))),
      page,
      pageSize,
      total: result.total,
    }
  }

  return {
    createPlan,
    listPlans,
    getPlan,
    updatePlan,
    approvePlan,
    cancelPlan,
    listEventsPage,
    ...execution,
  }
}

/** 判断唯一约束冲突；Drizzle 可能把数据库错误包在 cause 中。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = Reflect.get(error, 'code')
  if (code === '23505') return true
  return 'cause' in error && isUniqueViolation(Reflect.get(error, 'cause'))
}

export type OperationsService = ReturnType<typeof createOperationsService>
