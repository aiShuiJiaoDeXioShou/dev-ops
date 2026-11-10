import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { serviceRunVersion, serviceRunVersionChange } from './delivery.tables.ts'
import type { DeliveryExecutor } from './delivery.repository.ts'

/** 新建运行版本所需的完整字段。 */
export interface NewRunVersion {
  id: string
  teamId: string
  projectId: string
  serviceId: string
  environment: string
  versionLabel: string | null
  source: string
  evidenceUrl: string | null
  verificationStatus: string
  confirmedByUserId: string | null
  confirmedAt: Date | null
}

/** 运行版本条件更新字段；确认动作一次覆盖全部可写状态。 */
export interface RunVersionUpdateFields {
  versionLabel: string | null
  source: string
  evidenceUrl: string | null
  verificationStatus: string
  confirmedByUserId: string | null
  confirmedAt: Date | null
}

/** 新建运行版本变化历史所需的完整字段。 */
export interface NewRunVersionChange {
  id: string
  teamId: string
  projectId: string
  serviceId: string
  environment: string
  previousVersionLabel: string | null
  newVersionLabel: string | null
  previousStatus: string
  newStatus: string
  source: string
  evidenceUrl: string | null
  reason: string | null
  changedByUserId: string
}

/**
 * 查询服务在指定环境的运行版本。
 * @param db 数据库连接。
 * @param serviceId 服务标识。
 * @param environment 环境。
 * @returns 运行版本行；尚无记录时返回 undefined。
 */
export async function findRunVersion(db: Database, serviceId: string, environment: string) {
  const [row] = await db
    .select()
    .from(serviceRunVersion)
    .where(and(eq(serviceRunVersion.service_id, serviceId), eq(serviceRunVersion.environment, environment)))
    .limit(1)
  return row
}

/** 查询服务在各环境的运行版本。服务内环境数量固定，一次读取避免逐环境查询。 */
export async function findRunVersionsByService(db: Database, serviceId: string) {
  return db.select().from(serviceRunVersion).where(eq(serviceRunVersion.service_id, serviceId))
}

/** 插入运行版本当前状态。 */
export async function insertRunVersion(executor: DeliveryExecutor, input: NewRunVersion) {
  const [row] = await executor
    .insert(serviceRunVersion)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      environment: input.environment,
      version_label: input.versionLabel,
      source: input.source,
      evidence_url: input.evidenceUrl,
      verification_status: input.verificationStatus,
      confirmed_by_user_id: input.confirmedByUserId,
      confirmed_at: input.confirmedAt,
    })
    .returning()
  if (!row) throw new Error('运行版本写入失败')
  return row
}

/**
 * 按期望版本条件更新运行版本；受影响行数为 0 表示并发冲突。
 * @param executor 数据库连接或事务。
 * @param runVersionId 运行版本标识。
 * @param expectedVersion 期望的当前版本号。
 * @param fields 确认后的完整状态。
 * @returns 更新后的行或 undefined。
 */
export async function updateRunVersion(
  executor: DeliveryExecutor,
  runVersionId: string,
  expectedVersion: number,
  fields: RunVersionUpdateFields,
) {
  const [row] = await executor
    .update(serviceRunVersion)
    .set({
      version_label: fields.versionLabel,
      source: fields.source,
      evidence_url: fields.evidenceUrl,
      verification_status: fields.verificationStatus,
      confirmed_by_user_id: fields.confirmedByUserId,
      confirmed_at: fields.confirmedAt,
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(and(eq(serviceRunVersion.id, runVersionId), eq(serviceRunVersion.version, expectedVersion)))
    .returning()
  return row
}

/** 插入运行版本变化历史。 */
export async function insertRunVersionChange(executor: DeliveryExecutor, input: NewRunVersionChange) {
  const [row] = await executor
    .insert(serviceRunVersionChange)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      environment: input.environment,
      previous_version_label: input.previousVersionLabel,
      new_version_label: input.newVersionLabel,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      source: input.source,
      evidence_url: input.evidenceUrl,
      reason: input.reason,
      changed_by_user_id: input.changedByUserId,
    })
    .returning()
  if (!row) throw new Error('运行版本历史写入失败')
  return row
}

/**
 * 分页查询运行版本变化历史。
 * @param db 数据库连接。
 * @param serviceId 服务标识。
 * @param environment 环境。
 * @param page 页码，从 1 开始。
 * @param pageSize 每页数量。
 * @returns 变化历史行与总数，按变化时间倒序。
 */
export async function findRunVersionChanges(
  db: Database,
  serviceId: string,
  environment: string,
  page: number,
  pageSize: number,
) {
  const where = and(
    eq(serviceRunVersionChange.service_id, serviceId),
    eq(serviceRunVersionChange.environment, environment),
  )
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(serviceRunVersionChange)
      .where(where)
      .orderBy(desc(serviceRunVersionChange.created_at), desc(serviceRunVersionChange.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(serviceRunVersionChange).where(where),
  ])
  return { rows, total: totalRow?.value ?? 0 }
}
