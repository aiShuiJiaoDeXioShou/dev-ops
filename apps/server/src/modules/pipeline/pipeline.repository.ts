import { and, asc, count, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import type { RunPlanTemplate } from './pipeline.planner.ts'
import { pipelineArtifact, pipelineRun, pipelineRunLog, pipelineRunStep } from './pipeline.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type PipelineExecutor = Database | TransactionDatabase

/**
 * 运行表显式字段投影。
 *
 * 查询不读取 `workflow_snapshot`、`run_plan` 等大字段，只有租约生成需要运行计划时才单独读取；
 * 与 AGENTS.md「显式字段查询」一致，避免把快照内容带进列表响应与日志。
 */
const runListColumns = {
  id: pipelineRun.id,
  team_id: pipelineRun.team_id,
  project_id: pipelineRun.project_id,
  repository_id: pipelineRun.repository_id,
  workflow_path: pipelineRun.workflow_path,
  workflow_name: pipelineRun.workflow_name,
  git_ref: pipelineRun.git_ref,
  commit_sha: pipelineRun.commit_sha,
  run_kind: pipelineRun.run_kind,
  secret_environment: pipelineRun.secret_environment,
  status: pipelineRun.status,
  trigger_source: pipelineRun.trigger_source,
  initiator_channel: pipelineRun.initiator_channel,
  triggered_by_user_id: pipelineRun.triggered_by_user_id,
  node_id: pipelineRun.node_id,
  timeout_seconds: pipelineRun.timeout_seconds,
  error_code: pipelineRun.error_code,
  error_message: pipelineRun.error_message,
  cancel_requested_at: pipelineRun.cancel_requested_at,
  assigned_at: pipelineRun.assigned_at,
  started_at: pipelineRun.started_at,
  finished_at: pipelineRun.finished_at,
  created_at: pipelineRun.created_at,
  updated_at: pipelineRun.updated_at,
} as const

/** 运行全量字段投影；仅在需要运行计划与快照的实现用例中使用。 */
const runFullColumns = {
  ...runListColumns,
  inputs: pipelineRun.inputs,
  run_plan: pipelineRun.run_plan,
  workflow_snapshot: pipelineRun.workflow_snapshot,
  workflow_hash: pipelineRun.workflow_hash,
  cancel_requested_by_user_id: pipelineRun.cancel_requested_by_user_id,
} as const

const stepColumns = {
  id: pipelineRunStep.id,
  team_id: pipelineRunStep.team_id,
  project_id: pipelineRunStep.project_id,
  run_id: pipelineRunStep.run_id,
  step_index: pipelineRunStep.step_index,
  name: pipelineRunStep.name,
  kind: pipelineRunStep.kind,
  status: pipelineRunStep.status,
  exit_code: pipelineRunStep.exit_code,
  error_code: pipelineRunStep.error_code,
  error_message: pipelineRunStep.error_message,
  started_at: pipelineRunStep.started_at,
  finished_at: pipelineRunStep.finished_at,
  created_at: pipelineRunStep.created_at,
  updated_at: pipelineRunStep.updated_at,
} as const

const logColumns = {
  id: pipelineRunLog.id,
  run_id: pipelineRunLog.run_id,
  step_index: pipelineRunLog.step_index,
  seq: pipelineRunLog.seq,
  storage_key: pipelineRunLog.storage_key,
  size_bytes: pipelineRunLog.size_bytes,
  created_at: pipelineRunLog.created_at,
} as const

const artifactColumns = {
  id: pipelineArtifact.id,
  team_id: pipelineArtifact.team_id,
  project_id: pipelineArtifact.project_id,
  run_id: pipelineArtifact.run_id,
  step_index: pipelineArtifact.step_index,
  name: pipelineArtifact.name,
  storage_key: pipelineArtifact.storage_key,
  size_bytes: pipelineArtifact.size_bytes,
  sha256: pipelineArtifact.sha256,
  status: pipelineArtifact.status,
  created_at: pipelineArtifact.created_at,
} as const

/** 运行列表行；与 `runListColumns` 对应。 */
export type PipelineRunListRow = NonNullable<Awaited<ReturnType<typeof findPipelineRunById>>>
/** 运行步骤行。 */
export type PipelineRunStepRow = Awaited<ReturnType<typeof findPipelineRunSteps>>[number]
/** 产物行。 */
export type PipelineArtifactRow = Awaited<ReturnType<typeof findPipelineArtifacts>>[number]

/** 运行列表筛选；from/to 为 UTC 时间范围，page 从 1 开始。 */
export interface PipelineRunListFilters {
  workflowPath?: string
  status?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

/** 运行状态条件更新的可写字段；只允许状态机与调度流程写入这些字段。 */
export interface PipelineRunUpdateFields {
  status: string
  nodeId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  assignedAt?: Date | null
  startedAt?: Date | null
  finishedAt?: Date | null
  cancelRequestedAt?: Date | null
  cancelRequestedByUserId?: string | null
}

/** 新建运行输入；运行计划模板与工作流快照在触发时固定。 */
export interface NewPipelineRun {
  id: string
  teamId: string
  projectId: string
  repositoryId: string
  workflowPath: string
  workflowName: string | null
  gitRef: string
  commitSha: string
  inputs: Record<string, unknown>
  runPlan: RunPlanTemplate
  workflowSnapshot: string
  workflowHash: string
  status: string
  triggerSource: string
  initiatorChannel: string
  triggeredByUserId: string
  idempotencyKey: string
  timeoutSeconds: number
  runKind?: 'workflow' | 'code_change'
  secretEnvironment?: 'development' | 'test' | 'production'
}

/** 把运行计划模板转换为 jsonb 可写入的普通对象；保留全部字段，不做断言。 */
function toJsonbRecord(value: RunPlanTemplate): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) record[key] = field
  return record
}

/** 新建步骤快照输入。 */
export interface NewPipelineRunStep {
  id: string
  teamId: string
  projectId: string
  runId: string
  stepIndex: number
  name: string
  kind: string
  status: string
}

/** 运行日志聚合元数据；详情接口只返回聚合值，不返回分片存储位置。 */
export interface PipelineRunLogStat {
  stepIndex: number
  chunkCount: number
  sizeBytes: number
  lastSeq: number
}

function buildRunFilters(projectId: string, filters: PipelineRunListFilters) {
  const conditions = [eq(pipelineRun.project_id, projectId)]
  if (filters.workflowPath) conditions.push(eq(pipelineRun.workflow_path, filters.workflowPath))
  if (filters.status) conditions.push(eq(pipelineRun.status, filters.status))
  if (filters.from) conditions.push(gte(pipelineRun.created_at, filters.from))
  if (filters.to) conditions.push(lte(pipelineRun.created_at, filters.to))
  return and(...conditions)
}

/** 查询超过保留期的可用产物，供清理任务使用；按创建时间升序避免积压。 */
export async function findExpiredPipelineArtifacts(db: Database, cutoff: Date, limit = 200) {
  return db
    .select()
    .from(pipelineArtifact)
    .where(and(eq(pipelineArtifact.status, 'available'), lt(pipelineArtifact.created_at, cutoff)))
    .orderBy(pipelineArtifact.created_at)
    .limit(limit)
}

/** 将产物标记为缺失；文件删除失败时也标记，调用方可在下轮重试。 */
export async function markPipelineArtifactsMissing(db: Database, artifactIds: string[]): Promise<number> {
  if (artifactIds.length === 0) return 0
  const rows = await db
    .update(pipelineArtifact)
    .set({ status: 'missing', updated_at: new Date() })
    .where(inArray(pipelineArtifact.id, artifactIds))
    .returning({ id: pipelineArtifact.id })
  return rows.length
}

/** 判断错误是否由唯一约束冲突引起；统一从平台数据库工具导出，供流水线内部复用。 */
export { isUniqueViolation } from '../../platform/database/errors.ts'

/** 按标识查找运行摘要；不读取运行计划与工作流快照。 */
export async function findPipelineRunById(db: PipelineExecutor, runId: string) {
  const [row] = await db.select(runListColumns).from(pipelineRun).where(eq(pipelineRun.id, runId)).limit(1)
  return row
}

/** 按标识读取运行全量行；仅租约生成与完成收口使用。 */
export async function findPipelineRunWithPlan(db: PipelineExecutor, runId: string) {
  const [row] = await db.select(runFullColumns).from(pipelineRun).where(eq(pipelineRun.id, runId)).limit(1)
  return row
}

/** 按项目幂等键查找运行摘要。 */
export async function findPipelineRunByIdempotency(db: PipelineExecutor, projectId: string, idempotencyKey: string) {
  const [row] = await db
    .select(runListColumns)
    .from(pipelineRun)
    .where(and(eq(pipelineRun.project_id, projectId), eq(pipelineRun.idempotency_key, idempotencyKey)))
    .limit(1)
  return row
}

/**
 * 插入运行。
 * @returns 新运行摘要行；幂等唯一约束冲突时抛出，由 service 映射为返回已有运行。
 */
export async function insertPipelineRun(executor: PipelineExecutor, input: NewPipelineRun) {
  const [row] = await executor
    .insert(pipelineRun)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      repository_id: input.repositoryId,
      workflow_path: input.workflowPath,
      workflow_name: input.workflowName,
      git_ref: input.gitRef,
      commit_sha: input.commitSha,
      inputs: input.inputs,
      run_plan: toJsonbRecord(input.runPlan),
      workflow_snapshot: input.workflowSnapshot,
      workflow_hash: input.workflowHash,
      status: input.status,
      trigger_source: input.triggerSource,
      initiator_channel: input.initiatorChannel,
      triggered_by_user_id: input.triggeredByUserId,
      idempotency_key: input.idempotencyKey,
      timeout_seconds: input.timeoutSeconds,
      run_kind: input.runKind ?? 'workflow',
      secret_environment: input.secretEnvironment ?? 'production',
    })
    .returning(runListColumns)
  return row
}

/**
 * 以当前状态集合为条件更新运行，避免旧 Agent/Worker 覆盖终态。
 * @param db 数据库连接或事务。
 * @param runId 运行标识。
 * @param fromStatuses 允许的当前状态；为空时不会匹配任何行。
 * @param fields 状态与可选时间/错误字段。
 * @returns 更新后的运行摘要；状态不匹配时返回 undefined，调用方必须检查受影响行数。
 */
export async function updatePipelineRunStatus(
  db: PipelineExecutor,
  runId: string,
  fromStatuses: string[],
  fields: PipelineRunUpdateFields,
) {
  if (fromStatuses.length === 0) return undefined
  const [row] = await db
    .update(pipelineRun)
    .set({
      status: fields.status,
      node_id: fields.nodeId ?? undefined,
      error_code: fields.errorCode ?? undefined,
      error_message: fields.errorMessage ?? undefined,
      assigned_at: fields.assignedAt ?? undefined,
      started_at: fields.startedAt ?? undefined,
      finished_at: fields.finishedAt ?? undefined,
      cancel_requested_at: fields.cancelRequestedAt ?? undefined,
      cancel_requested_by_user_id: fields.cancelRequestedByUserId ?? undefined,
      updated_at: new Date(),
    })
    .where(and(eq(pipelineRun.id, runId), inArray(pipelineRun.status, fromStatuses)))
    .returning(runListColumns)
  return row
}

/** 查询项目运行列表与总数；按创建时间倒序、id 倒序保证排序稳定。 */
export async function findPipelineRuns(db: Database, projectId: string, filters: PipelineRunListFilters) {
  const where = buildRunFilters(projectId, filters)
  const [rows, totals] = await Promise.all([
    db
      .select(runListColumns)
      .from(pipelineRun)
      .where(where)
      .orderBy(desc(pipelineRun.created_at), desc(pipelineRun.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(pipelineRun).where(where),
  ])
  return { rows, total: Number(totals[0]?.total ?? 0) }
}

/**
 * 查询项目内多个工作流路径的最近一次运行，供工作流列表展示 lastRun。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param workflowPaths 工作流路径列表。
 * @returns 每个路径最新一条运行摘要的 Map；限定读取上限避免无限查询。
 */
export async function findLatestRunsByWorkflowPaths(db: Database, projectId: string, workflowPaths: string[]) {
  const paths = [...new Set(workflowPaths)].slice(0, 100)
  if (paths.length === 0) return new Map<string, PipelineRunListRow>()
  const rows = await db
    .select(runListColumns)
    .from(pipelineRun)
    .where(and(eq(pipelineRun.project_id, projectId), inArray(pipelineRun.workflow_path, paths)))
    .orderBy(desc(pipelineRun.created_at), desc(pipelineRun.id))
    .limit(500)
  const latest = new Map<string, PipelineRunListRow>()
  for (const row of rows) {
    if (!latest.has(row.workflow_path)) latest.set(row.workflow_path, row)
  }
  return latest
}

/** 按状态与创建时间批量读取待调度或待监控运行；调度只使用 created_at 升序稳定顺序。 */
export async function findPipelineRunsByStatuses(
  db: PipelineExecutor,
  statuses: string[],
  limit: number,
  order: 'created' | 'started' = 'created',
) {
  return db
    .select(runListColumns)
    .from(pipelineRun)
    .where(inArray(pipelineRun.status, statuses))
    .orderBy(order === 'created' ? asc(pipelineRun.created_at) : asc(pipelineRun.started_at), asc(pipelineRun.id))
    .limit(limit)
}

/**
 * 在事务内用行锁领取一个排队运行；SKIP LOCKED 保证多个 Worker 不互相等待。
 * @param tx 事务连接。
 * @param runId 候选运行标识。
 * @param nodeId 分配节点。
 * @param at 分配时间。
 * @returns 更新后的运行摘要；运行已被其他人领取时返回 undefined。
 */
export async function assignPipelineRunToNode(tx: TransactionDatabase, runId: string, nodeId: string, at: Date) {
  const [row] = await tx
    .update(pipelineRun)
    .set({ status: 'assigned', node_id: nodeId, assigned_at: at, updated_at: at })
    .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'queued')))
    .returning(runListColumns)
  return row
}

/**
 * 条件更新单条运行到指定状态，并用 SKIP LOCKED 锁住候选行，供 Worker 领取。
 * @param tx 事务连接。
 * @param runId 运行标识。
 * @param nodeId 分配节点。
 * @param at 分配时间。
 * @returns 分配后的行；未命中时返回 undefined。
 */
export async function claimQueuedPipelineRun(tx: TransactionDatabase, runId: string, nodeId: string, at: Date) {
  const [locked] = await tx
    .select({ id: pipelineRun.id })
    .from(pipelineRun)
    .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'queued')))
    .limit(1)
    .for('update', { skipLocked: true })
  if (!locked) return undefined
  return assignPipelineRunToNode(tx, runId, nodeId, at)
}

/** 插入运行步骤快照；由唯一约束保证同一运行内步骤序号唯一。 */
export async function insertPipelineRunSteps(executor: PipelineExecutor, steps: NewPipelineRunStep[]) {
  if (steps.length === 0) return
  await executor.insert(pipelineRunStep).values(
    steps.map((step) => ({
      id: step.id,
      team_id: step.teamId,
      project_id: step.projectId,
      run_id: step.runId,
      step_index: step.stepIndex,
      name: step.name,
      kind: step.kind,
      status: step.status,
    })),
  )
}

/** 查询运行步骤，按全局序号升序。 */
export async function findPipelineRunSteps(db: PipelineExecutor, runId: string) {
  return db
    .select(stepColumns)
    .from(pipelineRunStep)
    .where(eq(pipelineRunStep.run_id, runId))
    .orderBy(asc(pipelineRunStep.step_index))
}

/** 按运行与序号读取单个步骤。 */
export async function findPipelineRunStep(db: PipelineExecutor, runId: string, stepIndex: number) {
  const [row] = await db
    .select(stepColumns)
    .from(pipelineRunStep)
    .where(and(eq(pipelineRunStep.run_id, runId), eq(pipelineRunStep.step_index, stepIndex)))
    .limit(1)
  return row
}

/** 步骤状态条件更新的可写字段。 */
export interface PipelineStepUpdateFields {
  status: string
  exitCode?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: Date | null
  finishedAt?: Date | null
}

/**
 * 以当前状态集合为条件更新步骤状态，避免取消后旧 Agent 覆盖终态。
 * @returns 更新后的步骤行；状态不匹配时返回 undefined。
 */
export async function updatePipelineRunStepStatus(
  db: PipelineExecutor,
  runId: string,
  stepIndex: number,
  fromStatuses: string[],
  fields: PipelineStepUpdateFields,
) {
  if (fromStatuses.length === 0) return undefined
  const [row] = await db
    .update(pipelineRunStep)
    .set({
      status: fields.status,
      exit_code: fields.exitCode ?? undefined,
      error_code: fields.errorCode ?? undefined,
      error_message: fields.errorMessage ?? undefined,
      started_at: fields.startedAt ?? undefined,
      finished_at: fields.finishedAt ?? undefined,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(pipelineRunStep.run_id, runId),
        eq(pipelineRunStep.step_index, stepIndex),
        inArray(pipelineRunStep.status, fromStatuses),
      ),
    )
    .returning(stepColumns)
  return row
}

/** 将运行内仍为 pending 的步骤标记为 skipped；用于失败/取消/中断收口。 */
export async function skipPendingPipelineRunSteps(executor: PipelineExecutor, runId: string) {
  const rows = await executor
    .update(pipelineRunStep)
    .set({ status: 'skipped', finished_at: new Date(), updated_at: new Date() })
    .where(and(eq(pipelineRunStep.run_id, runId), eq(pipelineRunStep.status, 'pending')))
    .returning({ id: pipelineRunStep.id })
  return rows.length
}

/**
 * 插入日志分片元数据。
 * @returns 是否真正插入；重复 (runId, stepIndex, seq) 返回 false，不覆盖已有内容。
 */
export async function insertPipelineRunLog(
  executor: PipelineExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    runId: string
    stepIndex: number
    seq: number
    storageKey: string
    sizeBytes: number
  },
) {
  const rows = await executor
    .insert(pipelineRunLog)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      run_id: input.runId,
      step_index: input.stepIndex,
      seq: input.seq,
      storage_key: input.storageKey,
      size_bytes: input.sizeBytes,
    })
    .onConflictDoNothing({ target: [pipelineRunLog.run_id, pipelineRunLog.step_index, pipelineRunLog.seq] })
    .returning({ id: pipelineRunLog.id })
  return rows.length > 0
}

/**
 * 判断日志增量游标是否生效。
 * @param stepIndex 步骤序号；省略表示跨步骤合并读取。
 * @returns 仅在指定步骤时应用 afterSeq；seq 每步从 0 重置，合并读取用全局 seq 过滤会跳过分片。
 */
export function shouldApplyLogAfterSeq(stepIndex: number | undefined): boolean {
  return stepIndex !== undefined
}

/**
 * 读取日志分片。
 * @param stepIndex 步骤序号；省略时从起点合并读取所有步骤，忽略 afterSeq。
 * @param afterSeq 步骤内“不含”游标；仅在指定步骤时生效。
 * @returns 按 (step_index, seq) 升序的日志分片，最多 limit 条。
 */
export async function findPipelineRunLogs(
  db: PipelineExecutor,
  runId: string,
  stepIndex: number | undefined,
  afterSeq: number,
  limit: number,
) {
  const conditions = [eq(pipelineRunLog.run_id, runId)]
  if (shouldApplyLogAfterSeq(stepIndex)) conditions.push(sql`${pipelineRunLog.seq} > ${afterSeq}`)
  if (stepIndex !== undefined) conditions.push(eq(pipelineRunLog.step_index, stepIndex))
  return db
    .select(logColumns)
    .from(pipelineRunLog)
    .where(and(...conditions))
    .orderBy(asc(pipelineRunLog.step_index), asc(pipelineRunLog.seq))
    .limit(limit)
}

/** 查询指定步骤当前已接受的最大日志序号；不存在时返回 -1。 */
export async function findLastPipelineRunLogSeq(db: PipelineExecutor, runId: string, stepIndex: number) {
  const [row] = await db
    .select({ seq: pipelineRunLog.seq })
    .from(pipelineRunLog)
    .where(and(eq(pipelineRunLog.run_id, runId), eq(pipelineRunLog.step_index, stepIndex)))
    .orderBy(desc(pipelineRunLog.seq))
    .limit(1)
  return row?.seq ?? -1
}

/** 统计指定步骤已保存的日志总字节数；用于单步骤日志上限判断。 */
export async function sumPipelineRunLogBytes(db: PipelineExecutor, runId: string, stepIndex: number) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${pipelineRunLog.size_bytes}), 0)` })
    .from(pipelineRunLog)
    .where(and(eq(pipelineRunLog.run_id, runId), eq(pipelineRunLog.step_index, stepIndex)))
  return Number(row?.total ?? 0)
}

/** 按步骤聚合日志元数据（分片数、字节数、最大序号）。 */
export async function aggregatePipelineRunLogs(db: PipelineExecutor, runId: string): Promise<PipelineRunLogStat[]> {
  const rows = await db
    .select({
      stepIndex: pipelineRunLog.step_index,
      chunkCount: count(),
      sizeBytes: sql<string>`coalesce(sum(${pipelineRunLog.size_bytes}), 0)`,
      lastSeq: sql<number>`max(${pipelineRunLog.seq})`,
    })
    .from(pipelineRunLog)
    .where(eq(pipelineRunLog.run_id, runId))
    .groupBy(pipelineRunLog.step_index)
    .orderBy(asc(pipelineRunLog.step_index))
  return rows.map((row) => ({
    stepIndex: row.stepIndex,
    chunkCount: Number(row.chunkCount),
    sizeBytes: Number(row.sizeBytes),
    lastSeq: Number(row.lastSeq),
  }))
}

/** 查找指定步骤内某个序号的日志元数据，用于区分重复分片与序号回退。 */
export async function findPipelineRunLogChunk(db: PipelineExecutor, runId: string, stepIndex: number, seq: number) {
  const [row] = await db
    .select(logColumns)
    .from(pipelineRunLog)
    .where(and(eq(pipelineRunLog.run_id, runId), eq(pipelineRunLog.step_index, stepIndex), eq(pipelineRunLog.seq, seq)))
    .limit(1)
  return row
}

/** 插入产物元数据；唯一约束 uk_pipeline_artifact_run_name 防止运行内重名。 */
export async function insertPipelineArtifact(
  executor: PipelineExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    runId: string
    stepIndex: number
    name: string
    storageKey: string
    sizeBytes: number
    sha256: string
    status: string
  },
) {
  const [row] = await executor
    .insert(pipelineArtifact)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      run_id: input.runId,
      step_index: input.stepIndex,
      name: input.name,
      storage_key: input.storageKey,
      size_bytes: input.sizeBytes,
      sha256: input.sha256,
      status: input.status,
    })
    .returning(artifactColumns)
  return row
}

/** 查询运行产物列表，按创建时间倒序。 */
export async function findPipelineArtifacts(db: PipelineExecutor, runId: string) {
  return db
    .select(artifactColumns)
    .from(pipelineArtifact)
    .where(eq(pipelineArtifact.run_id, runId))
    .orderBy(desc(pipelineArtifact.created_at), desc(pipelineArtifact.id))
}

/** 按标识查找产物。 */
export async function findPipelineArtifactById(db: PipelineExecutor, artifactId: string) {
  const [row] = await db
    .select(artifactColumns)
    .from(pipelineArtifact)
    .where(eq(pipelineArtifact.id, artifactId))
    .limit(1)
  return row
}

/** 按运行与产物名查找，用于返回重名冲突而不是覆盖既有产物。 */
export async function findPipelineArtifactByRunName(db: PipelineExecutor, runId: string, name: string) {
  const [row] = await db
    .select(artifactColumns)
    .from(pipelineArtifact)
    .where(and(eq(pipelineArtifact.run_id, runId), eq(pipelineArtifact.name, name)))
    .limit(1)
  return row
}

/** 查询运行触发输入；单独读取避免列表与详情主查询携带大字段。 */
export async function findPipelineRunInputs(db: PipelineExecutor, runId: string) {
  const [row] = await db
    .select({ inputs: pipelineRun.inputs })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId))
    .limit(1)
  return row
}
