import type { Database } from '../../platform/database/client.ts'
import { loadOwnerRefs, ownerRefOf, type OwnerRef } from '../identity/identity.display.ts'
import { changeExecution, changePlan, changePlanEvent } from './operations.tables.ts'

type PlanRow = typeof changePlan.$inferSelect
type ExecutionRow = typeof changeExecution.$inferSelect
type EventRow = typeof changePlanEvent.$inferSelect

/** 变更计划视图；动作可用性由服务端按权限与状态计算。 */
export interface ChangePlanView {
  id: string
  projectId: string
  serviceId: string | null
  targetResource: string
  environment: string
  operationKind: string
  status: string
  revision: number
  versionLabel: string
  scopeSummary: string
  evidence: string
  rollbackPlan: string
  executionMode: string
  workflowPath: string | null
  workflowRef: string | null
  approvedBy: OwnerRef | null
  approvedAt: string | null
  approvedRevision: number | null
  activeExecutionId: string | null
  startedAt: string | null
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdBy: OwnerRef | null
  createdAt: string
  updatedAt: string
  version: number
}

/** 执行尝试视图。 */
export interface ChangeExecutionView {
  id: string
  attempt: number
  planRevision: number
  status: string
  pipelineRunId: string | null
  startedAt: string | null
  finishedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  verificationStatus: string
  verificationEvidence: Record<string, unknown> | null
  healthStatus: string | null
  expectedVersionLabel: string
  actualVersionLabel: string | null
  verifiedBy: OwnerRef | null
  verifiedAt: string | null
  verificationNote: string | null
}

/** 变更事件视图。 */
export interface ChangePlanEventView {
  id: string
  eventType: string
  actor: OwnerRef | null
  summary: string
  payload: Record<string, unknown> | null
  createdAt: string
}

/** 计划动作可用性；由服务端权限与状态共同决定。 */
export interface ChangePlanActions {
  canUpdate: boolean
  canApprove: boolean
  canExecute: boolean
  canVerify: boolean
  canCancel: boolean
  canRetry: boolean
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

/**
 * 计划行转视图；批量加载创建人与放行人的团队可用性。
 * @param db 数据库连接。
 * @param row 计划行。
 * @returns 计划视图。
 */
export async function toChangePlanView(db: Database, row: PlanRow): Promise<ChangePlanView> {
  const refs = await loadOwnerRefs(
    db,
    row.team_id,
    [row.created_by_user_id, row.approved_by_user_id].filter((id): id is string => id !== null),
  )
  return {
    id: row.id,
    projectId: row.project_id,
    serviceId: row.service_id,
    targetResource: row.target_resource,
    environment: row.environment,
    operationKind: row.operation_kind,
    status: row.status,
    revision: row.revision,
    versionLabel: row.version_label,
    scopeSummary: row.scope_summary,
    evidence: row.evidence,
    rollbackPlan: row.rollback_plan,
    executionMode: row.execution_mode,
    workflowPath: row.workflow_path,
    workflowRef: row.workflow_ref,
    approvedBy: ownerRefOf(row.approved_by_user_id, refs),
    approvedAt: toIso(row.approved_at),
    approvedRevision: row.approved_revision,
    activeExecutionId: row.active_execution_id,
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdBy: ownerRefOf(row.created_by_user_id, refs),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

/**
 * 批量转换计划行，按行顺序返回视图。
 * @param db 数据库连接。
 * @param rows 计划行数组。
 * @returns 计划视图数组。
 */
export async function toChangePlanViews(db: Database, rows: PlanRow[]): Promise<ChangePlanView[]> {
  return Promise.all(rows.map((row) => toChangePlanView(db, row)))
}

/**
 * 执行尝试行转视图；验证人可用性按团队加载。
 * @param db 数据库连接。
 * @param row 执行尝试行。
 * @returns 执行视图。
 */
export async function toExecutionView(db: Database, row: ExecutionRow): Promise<ChangeExecutionView> {
  const refs = await loadOwnerRefs(db, row.team_id, row.verified_by_user_id === null ? [] : [row.verified_by_user_id])
  return {
    id: row.id,
    attempt: row.attempt,
    planRevision: row.plan_revision,
    status: row.status,
    pipelineRunId: row.pipeline_run_id,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    verificationStatus: row.verification_status,
    verificationEvidence: row.verification_evidence,
    healthStatus: row.health_status,
    expectedVersionLabel: row.expected_version_label,
    actualVersionLabel: row.actual_version_label,
    verifiedBy: ownerRefOf(row.verified_by_user_id, refs),
    verifiedAt: toIso(row.verified_at),
    verificationNote: row.verification_note,
  }
}

/**
 * 事件行转视图；操作者可用性按团队加载。
 * @param db 数据库连接。
 * @param row 事件行。
 * @returns 事件视图。
 */
export async function toChangePlanEventView(db: Database, row: EventRow): Promise<ChangePlanEventView> {
  const refs = await loadOwnerRefs(db, row.team_id, [row.actor_user_id])
  return {
    id: row.id,
    eventType: row.event_type,
    actor: ownerRefOf(row.actor_user_id, refs),
    summary: row.summary,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  }
}
