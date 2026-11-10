import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { buildArtifact, buildRecord, buildRecordCorrection, buildRecordTarget } from './delivery.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DeliveryExecutor = Database | TransactionDatabase

export interface NewBuildRecord {
  id: string
  teamId: string
  projectId: string
  serviceId: string | null
  environment: string | null
  buildKey: string
  versionLabel: string
  commitRef: string | null
  source: string
  sourceRunId: string | null
  collectedAt: Date
  resultStatus: string
  note: string | null
  reportedByUserId: string
  reporterKind: string
}

export interface NewArtifact {
  id: string
  teamId: string
  projectId: string
  buildId: string
  artifactType: string
  versionLabel: string
  accessUrl: string
  source: string
  collectedAt: Date
  note: string | null
  createdByUserId: string
}

export interface BuildListFilters {
  serviceId?: string
  environment?: string
  source?: string
  resultStatus?: string
  page: number
  pageSize: number
}

/**
 * 按业务唯一键查找构建记录。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param source 构建来源。
 * @param buildKey 构建标识。
 * @returns 构建行或 undefined。
 */
export async function findBuildByBusinessKey(db: Database, projectId: string, source: string, buildKey: string) {
  const [row] = await db
    .select()
    .from(buildRecord)
    .where(
      and(eq(buildRecord.project_id, projectId), eq(buildRecord.source, source), eq(buildRecord.build_key, buildKey)),
    )
    .limit(1)
  return row
}

/** 按标识查找构建记录。 */
export async function findBuildById(db: Database, buildId: string) {
  const [row] = await db.select().from(buildRecord).where(eq(buildRecord.id, buildId)).limit(1)
  return row
}

/** 在事务中锁定构建记录行，串行化更正写入。 */
export async function lockBuildForUpdate(tx: TransactionDatabase, buildId: string) {
  const [row] = await tx.select().from(buildRecord).where(eq(buildRecord.id, buildId)).for('update')
  return row
}

/** 插入构建记录。 */
export async function insertBuild(executor: DeliveryExecutor, input: NewBuildRecord) {
  const [row] = await executor
    .insert(buildRecord)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      environment: input.environment,
      build_key: input.buildKey,
      version_label: input.versionLabel,
      commit_ref: input.commitRef,
      source: input.source,
      source_run_id: input.sourceRunId,
      collected_at: input.collectedAt,
      result_status: input.resultStatus,
      note: input.note,
      reported_by_user_id: input.reportedByUserId,
      reporter_kind: input.reporterKind,
    })
    .returning()
  if (!row) throw new Error('构建记录写入失败')
  return row
}

/**
 * 按版本条件更新构建记录的安全字段；受影响行数为 0 表示版本冲突。
 * @param executor 数据库连接或事务。
 * @param buildId 构建标识。
 * @param expectedVersion 期望版本。
 * @param fields 允许更正的字段。
 * @returns 更新后的行或 undefined。
 */
export async function updateBuildFields(
  executor: DeliveryExecutor,
  buildId: string,
  expectedVersion: number,
  fields: {
    versionLabel?: string
    commitRef?: string | null
    resultStatus?: string
    note?: string | null
  },
) {
  const [row] = await executor
    .update(buildRecord)
    .set({
      ...(fields.versionLabel === undefined ? {} : { version_label: fields.versionLabel }),
      ...(fields.commitRef === undefined ? {} : { commit_ref: fields.commitRef }),
      ...(fields.resultStatus === undefined ? {} : { result_status: fields.resultStatus }),
      ...(fields.note === undefined ? {} : { note: fields.note }),
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(and(eq(buildRecord.id, buildId), eq(buildRecord.version, expectedVersion)))
    .returning()
  return row
}

/**
 * 查询项目构建记录分页。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 服务、环境、来源、状态与分页条件。
 * @returns 构建行与总数。
 */
export async function findBuilds(db: Database, projectId: string, filters: BuildListFilters) {
  const conditions = [eq(buildRecord.project_id, projectId)]
  if (filters.serviceId) conditions.push(eq(buildRecord.service_id, filters.serviceId))
  if (filters.environment) conditions.push(eq(buildRecord.environment, filters.environment))
  if (filters.source) conditions.push(eq(buildRecord.source, filters.source))
  if (filters.resultStatus) conditions.push(eq(buildRecord.result_status, filters.resultStatus))
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(buildRecord)
      .where(where)
      .orderBy(desc(buildRecord.collected_at), desc(buildRecord.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(buildRecord).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 插入构建记录更正历史。 */
export async function insertCorrection(
  executor: DeliveryExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    buildId: string
    previousSnapshot: Record<string, unknown>
    correctedFields: Record<string, unknown>
    reason: string
    correctedByUserId: string
  },
) {
  const [row] = await executor
    .insert(buildRecordCorrection)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      build_id: input.buildId,
      previous_snapshot: input.previousSnapshot,
      corrected_fields: input.correctedFields,
      reason: input.reason,
      corrected_by_user_id: input.correctedByUserId,
    })
    .returning()
  if (!row) throw new Error('构建更正记录写入失败')
  return row
}

/** 查询构建的更正历史。 */
export async function listCorrections(db: Database, buildId: string) {
  return db
    .select()
    .from(buildRecordCorrection)
    .where(eq(buildRecordCorrection.build_id, buildId))
    .orderBy(desc(buildRecordCorrection.created_at), desc(buildRecordCorrection.id))
}

/** 插入产物引用。 */
export async function insertArtifact(executor: DeliveryExecutor, input: NewArtifact) {
  const [row] = await executor
    .insert(buildArtifact)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      build_id: input.buildId,
      artifact_type: input.artifactType,
      version_label: input.versionLabel,
      access_url: input.accessUrl,
      source: input.source,
      collected_at: input.collectedAt,
      note: input.note,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('产物引用写入失败')
  return row
}

/** 批量查询构建的产物引用。 */
export async function listArtifactsForBuilds(db: Database, buildIds: string[]) {
  if (buildIds.length === 0) return []
  return db
    .select()
    .from(buildArtifact)
    .where(inArray(buildArtifact.build_id, buildIds))
    .orderBy(desc(buildArtifact.created_at), desc(buildArtifact.id))
}

/** 插入构建与事项关联。 */
export async function insertTarget(
  executor: DeliveryExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    buildId: string
    targetType: string
    targetId: string
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(buildRecordTarget)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      build_id: input.buildId,
      target_type: input.targetType,
      target_id: input.targetId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('构建关联写入失败')
  return row
}

/** 按构建与事项查找关联。 */
export async function findTarget(db: Database, buildId: string, targetType: string, targetId: string) {
  const [row] = await db
    .select()
    .from(buildRecordTarget)
    .where(
      and(
        eq(buildRecordTarget.build_id, buildId),
        eq(buildRecordTarget.target_type, targetType),
        eq(buildRecordTarget.target_id, targetId),
      ),
    )
    .limit(1)
  return row
}

/** 删除构建与事项关联；返回受影响行。 */
export async function deleteTarget(executor: DeliveryExecutor, buildId: string, targetId: string) {
  const rows = await executor
    .delete(buildRecordTarget)
    .where(and(eq(buildRecordTarget.build_id, buildId), eq(buildRecordTarget.target_id, targetId)))
    .returning()
  return rows.length
}

/** 批量查询构建的事项关联。 */
export async function listTargetsForBuilds(db: Database, buildIds: string[]) {
  if (buildIds.length === 0) return []
  return db
    .select()
    .from(buildRecordTarget)
    .where(inArray(buildRecordTarget.build_id, buildIds))
    .orderBy(desc(buildRecordTarget.created_at), desc(buildRecordTarget.id))
}
