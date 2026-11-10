import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { buildRecord, pipelineRun, pipelineRunStatus } from './delivery.tables.ts'
import type { DeliveryExecutor } from './delivery.repository.ts'

/** 新建流水线运行所需的完整字段。 */
export interface NewPipelineRun {
  id: string
  teamId: string
  projectId: string
  serviceId: string | null
  pipelineName: string
  pipelineKey: string
  commitRef: string | null
  triggerSource: string
  status: string
  startedAt: Date | null
  finishedAt: Date | null
  resultUrl: string | null
  source: string
  sourceRunId: string
  lastReportedAt: Date
}

/** 流水线运行更新字段；未提供的字段保持不变，避免旧报告清空已知信息。 */
export interface PipelineRunUpdateFields {
  serviceId?: string | null
  pipelineName?: string
  pipelineKey?: string
  commitRef?: string | null
  triggerSource?: string
  status?: string
  startedAt?: Date | null
  finishedAt?: Date | null
  resultUrl?: string | null
}

/** 流水线运行状态历史写入字段。 */
export interface NewPipelineRunStatus {
  id: string
  teamId: string
  projectId: string
  pipelineRunId: string
  status: string
  reportedAt: Date
  note: string | null
}

/** 流水线运行列表筛选条件。 */
export interface PipelineRunListFilters {
  serviceId?: string
  status?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

/** 关联构建摘要；按来源运行标识在读取时关联，不新增关联表。 */
export type RelatedBuildRecord = {
  id: string
  version_label: string
  collected_at: Date
  result_status: string
}

/**
 * 按「项目＋来源＋来源运行标识」查找流水线运行。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param source 来源系统。
 * @param sourceRunId 来源运行标识。
 * @returns 运行行；不存在时返回 undefined。
 */
export async function findPipelineRunBySourceRun(db: Database, projectId: string, source: string, sourceRunId: string) {
  const [row] = await db
    .select()
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.project_id, projectId),
        eq(pipelineRun.source, source),
        eq(pipelineRun.source_run_id, sourceRunId),
      ),
    )
    .limit(1)
  return row
}

/**
 * 按标识查找流水线运行。
 * @param db 数据库连接。
 * @param runId 运行标识。
 * @returns 运行行；不存在时返回 undefined。
 */
export async function findPipelineRunById(db: Database, runId: string) {
  const [row] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId)).limit(1)
  return row
}

/** 插入流水线运行。 */
export async function insertPipelineRun(executor: DeliveryExecutor, input: NewPipelineRun) {
  const [row] = await executor
    .insert(pipelineRun)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      pipeline_name: input.pipelineName,
      pipeline_key: input.pipelineKey,
      commit_ref: input.commitRef,
      trigger_source: input.triggerSource,
      status: input.status,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      result_url: input.resultUrl,
      source: input.source,
      source_run_id: input.sourceRunId,
      last_reported_at: input.lastReportedAt,
    })
    .returning()
  if (!row) throw new Error('流水线运行写入失败')
  return row
}

/**
 * 仅当上报时间晚于已记录时间时更新运行；条件更新保证乱序旧报告无法覆盖新状态。
 * @param executor 数据库连接或事务。
 * @param runId 运行标识。
 * @param reportedAt 本次上报时间，写入 last_reported_at。
 * @param fields 本次要更新的字段。
 * @returns 更新后的行或 undefined；undefined 表示已有更新上报生效。
 */
export async function updatePipelineRun(
  executor: DeliveryExecutor,
  runId: string,
  reportedAt: Date,
  fields: PipelineRunUpdateFields,
) {
  const [row] = await executor
    .update(pipelineRun)
    .set({
      ...(fields.serviceId === undefined ? {} : { service_id: fields.serviceId }),
      ...(fields.pipelineName === undefined ? {} : { pipeline_name: fields.pipelineName }),
      ...(fields.pipelineKey === undefined ? {} : { pipeline_key: fields.pipelineKey }),
      ...(fields.commitRef === undefined ? {} : { commit_ref: fields.commitRef }),
      ...(fields.triggerSource === undefined ? {} : { trigger_source: fields.triggerSource }),
      ...(fields.status === undefined ? {} : { status: fields.status }),
      ...(fields.startedAt === undefined ? {} : { started_at: fields.startedAt }),
      ...(fields.finishedAt === undefined ? {} : { finished_at: fields.finishedAt }),
      ...(fields.resultUrl === undefined ? {} : { result_url: fields.resultUrl }),
      last_reported_at: reportedAt,
      updated_at: new Date(),
    })
    .where(and(eq(pipelineRun.id, runId), sql`${pipelineRun.last_reported_at} < ${reportedAt}`))
    .returning()
  return row
}

/** 插入流水线运行状态历史。 */
export async function insertPipelineRunStatus(executor: DeliveryExecutor, input: NewPipelineRunStatus) {
  const [row] = await executor
    .insert(pipelineRunStatus)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      pipeline_run_id: input.pipelineRunId,
      status: input.status,
      reported_at: input.reportedAt,
      note: input.note,
    })
    .returning()
  if (!row) throw new Error('流水线状态历史写入失败')
  return row
}

/** 查询流水线运行状态历史，按上报时间倒序。 */
export async function findPipelineRunStatuses(db: Database, runId: string) {
  return db
    .select()
    .from(pipelineRunStatus)
    .where(eq(pipelineRunStatus.pipeline_run_id, runId))
    .orderBy(desc(pipelineRunStatus.reported_at), desc(pipelineRunStatus.id))
}

/**
 * 分页查询项目流水线运行。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 服务、状态、开始时间范围与分页条件。
 * @returns 运行行与总数，按最近上报时间倒序。
 */
export async function findPipelineRuns(db: Database, projectId: string, filters: PipelineRunListFilters) {
  const conditions = [eq(pipelineRun.project_id, projectId)]
  if (filters.serviceId) conditions.push(eq(pipelineRun.service_id, filters.serviceId))
  if (filters.status) conditions.push(eq(pipelineRun.status, filters.status))
  if (filters.from) conditions.push(gte(pipelineRun.started_at, filters.from))
  if (filters.to) conditions.push(lte(pipelineRun.started_at, filters.to))
  const where = and(...conditions)
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(pipelineRun)
      .where(where)
      .orderBy(desc(pipelineRun.last_reported_at), desc(pipelineRun.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(pipelineRun).where(where),
  ])
  return { rows, total: totalRow?.value ?? 0 }
}

/**
 * 按来源运行标识查询可追溯的构建记录；用于运行详情展示关联构建，不写入关联表。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param sourceRunId 来源运行标识。
 * @returns 构建摘要，按采集时间倒序，最多 20 条。
 */
export async function findRelatedBuilds(db: Database, projectId: string, sourceRunId: string) {
  const rows = await db
    .select({
      id: buildRecord.id,
      version_label: buildRecord.version_label,
      collected_at: buildRecord.collected_at,
      result_status: buildRecord.result_status,
    })
    .from(buildRecord)
    .where(and(eq(buildRecord.project_id, projectId), eq(buildRecord.source_run_id, sourceRunId)))
    .orderBy(desc(buildRecord.collected_at), desc(buildRecord.id))
    .limit(20)
  return rows satisfies RelatedBuildRecord[]
}
