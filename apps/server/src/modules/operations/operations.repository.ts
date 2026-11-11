import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { changeExecution, changePlan, changePlanApproval, changePlanEvent } from './operations.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
/** 事务或连接；写用例允许传入事务客户端。 */
export type OperationsExecutor = Database | TransactionDatabase

/** 新建变更计划所需字段。 */
export interface NewChangePlan {
  id: string
  teamId: string
  projectId: string
  serviceId: string | null
  targetResource: string
  environment: string
  operationKind: string
  status: string
  versionLabel: string
  scopeSummary: string
  evidence: string
  rollbackPlan: string
  executionMode: string
  workflowPath: string | null
  workflowRef: string | null
  pipelineInputs: Record<string, unknown>
  createdByUserId: string
}

/** 计划可变字段；更新时覆盖全部内容字段。 */
export interface ChangePlanUpdateFields {
  serviceId: string | null
  targetResource: string
  environment: string
  operationKind: string
  versionLabel: string
  scopeSummary: string
  evidence: string
  rollbackPlan: string
  executionMode: string
  workflowPath: string | null
  workflowRef: string | null
  pipelineInputs: Record<string, unknown>
}

/** 计划列表筛选。 */
export interface ChangePlanListFilters {
  projectId?: string
  environment?: string
  status?: string
  operationKind?: string
  from?: Date
  to?: Date
}

/**
 * 插入变更计划。
 * @returns 新计划行。
 */
export async function insertChangePlan(executor: OperationsExecutor, input: NewChangePlan) {
  const [row] = await executor
    .insert(changePlan)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      target_resource: input.targetResource,
      environment: input.environment,
      operation_kind: input.operationKind,
      status: input.status,
      version_label: input.versionLabel,
      scope_summary: input.scopeSummary,
      evidence: input.evidence,
      rollback_plan: input.rollbackPlan,
      execution_mode: input.executionMode,
      workflow_path: input.workflowPath,
      workflow_ref: input.workflowRef,
      pipeline_inputs: input.pipelineInputs,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('变更计划写入失败')
  return row
}

/** 按标识读取计划。 */
export async function findChangePlanById(db: Database, planId: string) {
  const [row] = await db.select().from(changePlan).where(eq(changePlan.id, planId)).limit(1)
  return row
}

/**
 * 以版本为条件更新计划内容；同时递增修订与行版本。
 * @returns 更新后的行；版本不匹配时返回 undefined。
 */
export async function updateChangePlanContent(
  executor: OperationsExecutor,
  planId: string,
  expectedVersion: number,
  fields: ChangePlanUpdateFields,
) {
  const now = new Date()
  const [row] = await executor
    .update(changePlan)
    .set({
      service_id: fields.serviceId,
      target_resource: fields.targetResource,
      environment: fields.environment,
      operation_kind: fields.operationKind,
      version_label: fields.versionLabel,
      scope_summary: fields.scopeSummary,
      evidence: fields.evidence,
      rollback_plan: fields.rollbackPlan,
      execution_mode: fields.executionMode,
      workflow_path: fields.workflowPath,
      workflow_ref: fields.workflowRef,
      pipeline_inputs: fields.pipelineInputs,
      revision: sql`${changePlan.revision} + 1`,
      updated_at: now,
    })
    .where(and(eq(changePlan.id, planId), eq(changePlan.version, expectedVersion)))
    .returning()
  return row
}

/**
 * 以版本与状态为条件推进计划；只允许从给定状态迁移。
 * @returns 更新后的行；状态或版本不匹配返回 undefined。
 */
export async function transitionChangePlan(
  executor: OperationsExecutor,
  planId: string,
  expectedVersion: number,
  fromStatuses: string[],
  fields: Record<string, unknown>,
) {
  const now = new Date()
  const [row] = await executor
    .update(changePlan)
    .set({ ...fields, version: expectedVersion + 1, updated_at: now })
    .where(
      and(eq(changePlan.id, planId), eq(changePlan.version, expectedVersion), inArray(changePlan.status, fromStatuses)),
    )
    .returning()
  return row
}

/** 查询计划分页。 */
export async function findChangePlans(
  db: Database,
  teamId: string,
  filters: ChangePlanListFilters,
  page: { offset: number; limit: number },
) {
  const conditions = [eq(changePlan.team_id, teamId)]
  if (filters.projectId) conditions.push(eq(changePlan.project_id, filters.projectId))
  if (filters.environment) conditions.push(eq(changePlan.environment, filters.environment))
  if (filters.status) conditions.push(eq(changePlan.status, filters.status))
  if (filters.operationKind) conditions.push(eq(changePlan.operation_kind, filters.operationKind))
  if (filters.from) conditions.push(gte(changePlan.created_at, filters.from))
  if (filters.to) conditions.push(lte(changePlan.created_at, filters.to))
  const where = and(...conditions)
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(changePlan)
      .where(where)
      .orderBy(desc(changePlan.created_at), changePlan.id)
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(changePlan).where(where),
  ])
  return { rows, total: total[0]?.value ?? 0 }
}

/** 插入放行记录。 */
export async function insertChangePlanApproval(
  executor: OperationsExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    planId: string
    planRevision: number
    planSnapshot: Record<string, unknown>
    approvedByUserId: string
    approvedAt: Date
  },
) {
  const [row] = await executor
    .insert(changePlanApproval)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      plan_id: input.planId,
      plan_revision: input.planRevision,
      plan_snapshot: input.planSnapshot,
      approved_by_user_id: input.approvedByUserId,
      approved_at: input.approvedAt,
    })
    .returning()
  if (!row) throw new Error('放行记录写入失败')
  return row
}

/** 查询指定修订的有效放行记录。 */
export async function findValidApproval(db: Database, planId: string, revision: number) {
  const [row] = await db
    .select()
    .from(changePlanApproval)
    .where(
      and(
        eq(changePlanApproval.plan_id, planId),
        eq(changePlanApproval.plan_revision, revision),
        isNull(changePlanApproval.invalidated_at),
      ),
    )
    .limit(1)
  return row
}

/** 作废计划的全部有效放行记录。 */
export async function invalidatePlanApprovals(
  executor: OperationsExecutor,
  planId: string,
  reason: string,
): Promise<number> {
  const now = new Date()
  const rows = await executor
    .update(changePlanApproval)
    .set({ invalidated_at: now, invalidated_reason: reason, updated_at: now })
    .where(and(eq(changePlanApproval.plan_id, planId), isNull(changePlanApproval.invalidated_at)))
    .returning({ id: changePlanApproval.id })
  return rows.length
}

/** 插入计划事件；事件只增不改。 */
export async function insertChangePlanEvent(
  executor: OperationsExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    planId: string
    executionId?: string | null
    eventType: string
    actorUserId: string
    summary: string
    payload?: Record<string, unknown> | null
  },
) {
  await executor.insert(changePlanEvent).values({
    id: input.id,
    team_id: input.teamId,
    project_id: input.projectId,
    plan_id: input.planId,
    execution_id: input.executionId ?? null,
    event_type: input.eventType,
    actor_user_id: input.actorUserId,
    summary: input.summary,
    payload: input.payload ?? null,
  })
}

/** 按时间升序查询计划事件。 */
export async function findChangePlanEvents(db: Database, planId: string, limit = 50) {
  return db
    .select()
    .from(changePlanEvent)
    .where(eq(changePlanEvent.plan_id, planId))
    .orderBy(changePlanEvent.created_at, changePlanEvent.id)
    .limit(limit)
}

/** 按时间升序分页查询计划事件。 */
export async function findChangePlanEventsPage(db: Database, planId: string, page: { offset: number; limit: number }) {
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(changePlanEvent)
      .where(eq(changePlanEvent.plan_id, planId))
      .orderBy(changePlanEvent.created_at, changePlanEvent.id)
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(changePlanEvent).where(eq(changePlanEvent.plan_id, planId)),
  ])
  return { rows, total: total[0]?.value ?? 0 }
}

/** 按尝试序号升序查询计划的执行尝试。 */
export async function findExecutionsByPlan(db: Database, planId: string) {
  return db.select().from(changeExecution).where(eq(changeExecution.plan_id, planId)).orderBy(changeExecution.attempt)
}

/** 读取计划最近一条未失效的放行记录。 */
export async function findLatestValidApproval(db: Database, planId: string) {
  const [row] = await db
    .select()
    .from(changePlanApproval)
    .where(and(eq(changePlanApproval.plan_id, planId), isNull(changePlanApproval.invalidated_at)))
    .orderBy(desc(changePlanApproval.approved_at), changePlanApproval.id)
    .limit(1)
  return row
}

/** 新建执行尝试所需字段。 */
export interface NewChangeExecution {
  id: string
  teamId: string
  projectId: string
  planId: string
  planRevision: number
  attempt: number
  executionMode: string
  expectedVersionLabel: string
  createdByUserId: string
}

/** 插入执行尝试。 */
export async function insertChangeExecution(executor: OperationsExecutor, input: NewChangeExecution) {
  const [row] = await executor
    .insert(changeExecution)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      plan_id: input.planId,
      plan_revision: input.planRevision,
      attempt: input.attempt,
      execution_mode: input.executionMode,
      status: 'queued',
      expected_version_label: input.expectedVersionLabel,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('执行尝试写入失败')
  return row
}

/** 读取执行尝试。 */
export async function findChangeExecutionById(db: Database, executionId: string) {
  const [row] = await db.select().from(changeExecution).where(eq(changeExecution.id, executionId)).limit(1)
  return row
}

/** 读取计划最近一次执行尝试。 */
export async function findLatestChangeExecution(db: Database, planId: string) {
  const [row] = await db
    .select()
    .from(changeExecution)
    .where(eq(changeExecution.plan_id, planId))
    .orderBy(desc(changeExecution.attempt))
    .limit(1)
  return row
}

/** 按条件更新执行尝试，避免旧结果覆盖终态。 */
export async function updateChangeExecution(
  executor: OperationsExecutor,
  executionId: string,
  fromStatuses: string[],
  fields: Record<string, unknown>,
) {
  const [row] = await executor
    .update(changeExecution)
    .set({ ...fields, updated_at: new Date() })
    .where(and(eq(changeExecution.id, executionId), inArray(changeExecution.status, fromStatuses)))
    .returning()
  return row
}

/** 设置执行尝试的流水线运行标识。 */
export async function attachExecutionRun(executor: OperationsExecutor, executionId: string, pipelineRunId: string) {
  await executor
    .update(changeExecution)
    .set({ pipeline_run_id: pipelineRunId, updated_at: new Date() })
    .where(eq(changeExecution.id, executionId))
}

/** 读取执行尝试状态，用于取消时判断实际外部影响。 */
export async function findExecutionStatusById(db: Database, executionId: string) {
  const [row] = await db
    .select({
      id: changeExecution.id,
      status: changeExecution.status,
      pipeline_run_id: changeExecution.pipeline_run_id,
    })
    .from(changeExecution)
    .where(eq(changeExecution.id, executionId))
    .limit(1)
  return row
}
