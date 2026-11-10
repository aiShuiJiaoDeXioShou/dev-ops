import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { externalReview, releaseResult } from './delivery.tables.ts'
import type { DeliveryExecutor } from './delivery.repository.ts'

/** 新建外部提审记录所需的完整字段。 */
export interface NewExternalReview {
  id: string
  teamId: string
  projectId: string
  serviceId: string | null
  targetType: string
  versionLabel: string
  reviewPlatform: string
  submittedAt: Date
  submittedByUserId: string
  note: string | null
  evidenceUrl: string | null
}

/** 提审更新字段；审核状态更新走条件更新。 */
export interface ExternalReviewUpdateFields {
  reviewStatus: string
  reviewReason: string | null
  reviewedAt: Date | null
  evidenceUrl: string | null
}

/** 新建发布结果所需的完整字段。 */
export interface NewReleaseResult {
  id: string
  teamId: string
  projectId: string
  reviewId: string | null
  serviceId: string | null
  versionLabel: string
  releaseStatus: string
  releasedAt: Date | null
  scopeNote: string | null
  evidenceUrl: string | null
  version: number
  recordedByUserId: string
}

/** 提审列表筛选条件。 */
export interface ReviewListFilters {
  serviceId?: string
  targetType?: string
  reviewStatus?: string
  page: number
  pageSize: number
}

/** 发布结果列表筛选条件。 */
export interface ReleaseListFilters {
  serviceId?: string
  releaseStatus?: string
  reviewId?: string
  page: number
  pageSize: number
}

/**
 * 插入外部提审记录；重新提审新增记录，不覆盖历史。
 * @param executor 数据库连接或事务。
 * @param input 提审对象、版本、平台、提交信息与提交人。
 * @returns 新建的提审行。
 */
export async function insertExternalReview(executor: DeliveryExecutor, input: NewExternalReview) {
  const [row] = await executor
    .insert(externalReview)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      target_type: input.targetType,
      version_label: input.versionLabel,
      review_platform: input.reviewPlatform,
      submitted_at: input.submittedAt,
      submitted_by_user_id: input.submittedByUserId,
      note: input.note,
      evidence_url: input.evidenceUrl,
      review_status: 'pending',
    })
    .returning()
  if (!row) throw new Error('提审记录写入失败')
  return row
}

/**
 * 按标识查找外部提审记录。
 * @param db 数据库连接。
 * @param reviewId 提审标识。
 * @returns 提审行；不存在时返回 undefined。
 */
export async function findExternalReviewById(db: Database, reviewId: string) {
  const [row] = await db.select().from(externalReview).where(eq(externalReview.id, reviewId)).limit(1)
  return row
}

/**
 * 按期望版本条件更新提审状态；受影响行数为 0 表示并发冲突。
 * @param executor 数据库连接或事务。
 * @param reviewId 提审标识。
 * @param expectedVersion 期望的当前版本号。
 * @param fields 新的审核状态、原因、审核时间与证据。
 * @returns 更新后的行或 undefined。
 */
export async function updateExternalReview(
  executor: DeliveryExecutor,
  reviewId: string,
  expectedVersion: number,
  fields: ExternalReviewUpdateFields,
) {
  const [row] = await executor
    .update(externalReview)
    .set({
      review_status: fields.reviewStatus,
      review_reason: fields.reviewReason,
      reviewed_at: fields.reviewedAt,
      evidence_url: fields.evidenceUrl,
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(and(eq(externalReview.id, reviewId), eq(externalReview.version, expectedVersion)))
    .returning()
  return row
}

/**
 * 分页查询项目提审记录。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 服务、对象类型、审核状态与分页条件。
 * @returns 提审行与总数，按提交时间倒序。
 */
export async function findExternalReviews(db: Database, projectId: string, filters: ReviewListFilters) {
  const conditions = [eq(externalReview.project_id, projectId)]
  if (filters.serviceId) conditions.push(eq(externalReview.service_id, filters.serviceId))
  if (filters.targetType) conditions.push(eq(externalReview.target_type, filters.targetType))
  if (filters.reviewStatus) conditions.push(eq(externalReview.review_status, filters.reviewStatus))
  const where = and(...conditions)
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(externalReview)
      .where(where)
      .orderBy(desc(externalReview.submitted_at), desc(externalReview.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(externalReview).where(where),
  ])
  return { rows, total: totalRow?.value ?? 0 }
}

/**
 * 插入实际发布结果；与审核记录分离，不自动推进审核状态。
 * @param executor 数据库连接或事务。
 * @param input 发布版本、状态、时间、范围、证据与记录人。
 * @returns 新建的发布结果行。
 */
export async function insertReleaseResult(executor: DeliveryExecutor, input: NewReleaseResult) {
  const [row] = await executor
    .insert(releaseResult)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      review_id: input.reviewId,
      service_id: input.serviceId,
      version_label: input.versionLabel,
      release_status: input.releaseStatus,
      released_at: input.releasedAt,
      scope_note: input.scopeNote,
      evidence_url: input.evidenceUrl,
      version: input.version,
      recorded_by_user_id: input.recordedByUserId,
    })
    .returning()
  if (!row) throw new Error('发布结果写入失败')
  return row
}

/**
 * 按标识查找发布结果。
 * @param db 数据库连接。
 * @param releaseId 发布结果标识。
 * @returns 发布结果行；不存在时返回 undefined。
 */
export async function findReleaseResultById(db: Database, releaseId: string) {
  const [row] = await db.select().from(releaseResult).where(eq(releaseResult.id, releaseId)).limit(1)
  return row
}

/**
 * 分页查询项目发布结果，发布时间为空的记录排在最后。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 服务、发布状态、关联提审与分页条件。
 * @returns 发布结果行与总数。
 */
export async function findReleaseResults(db: Database, projectId: string, filters: ReleaseListFilters) {
  const conditions = [eq(releaseResult.project_id, projectId)]
  if (filters.serviceId) conditions.push(eq(releaseResult.service_id, filters.serviceId))
  if (filters.releaseStatus) conditions.push(eq(releaseResult.release_status, filters.releaseStatus))
  if (filters.reviewId) conditions.push(eq(releaseResult.review_id, filters.reviewId))
  const where = and(...conditions)
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(releaseResult)
      .where(where)
      .orderBy(sql`${releaseResult.released_at} desc nulls last`, desc(releaseResult.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(releaseResult).where(where),
  ])
  return { rows, total: totalRow?.value ?? 0 }
}
