import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { requireActiveProjectService, type RequireProjectAccess } from './delivery.access.ts'
import {
  findExternalReviewById,
  findExternalReviews,
  insertExternalReview,
  updateExternalReview,
  type ReviewListFilters,
} from './delivery.review.repository.ts'
import {
  optionalText,
  requireText,
  toReviewStatus,
  validateExternalUrl,
  validateReason,
  validateReviewStatus,
  validateReviewTargetType,
  validateTimestamp,
} from './delivery.validators.ts'
import { pageView, toReviewView, type PageView, type ReviewView } from './delivery.view.ts'

/** 创建外部提审记录的请求体。 */
export interface CreateReviewInput {
  targetType: string
  versionLabel: string
  reviewPlatform: string
  submittedAt: string
  serviceId?: string | null
  note?: string | null
  evidenceUrl?: string | null
}

/** 更新审核状态的请求体；version 为乐观锁，缺失时由 schema 拒绝。 */
export interface UpdateReviewInput {
  reviewStatus: string
  reviewReason?: string | null
  reviewedAt?: string | null
  evidenceUrl?: string | null
  version: number
}

/** 提审列表筛选与分页条件。 */
export interface ReviewListQuery {
  serviceId?: string
  targetType?: string
  reviewStatus?: string
  page: number
  pageSize: number
}

export interface ReviewUseCaseDeps {
  db: Database
  requireProject: RequireProjectAccess
}

/** 审核终态；进入终态后如需重新审核必须新增提审记录。 */
const REVIEW_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['approved', 'rejected', 'withdrawn'])

/**
 * 校验审核状态流转：待审核或未知可进入终态；未知可由任意状态回传；终态之间不可互相覆盖。
 * @param current 当前审核状态。
 * @param next 目标审核状态。
 * @throws 不允许的流转抛出 INVALID_TRANSITION。
 */
function assertReviewStatusTransition(current: string, next: string): void {
  if (current === next) return
  if (next === 'unknown') return
  if ((current === 'pending' || current === 'unknown') && (next === 'pending' || REVIEW_TERMINAL_STATUSES.has(next))) {
    return
  }
  throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '当前审核状态不能变更为目标状态，重新提审请新增记录')
}

/**
 * 创建外部提审与发布结果用例。
 * @param deps 数据库连接与项目访问校验。
 * @returns 提审创建/更新/查询与发布结果记录/查询用例。
 */
export function createReviewUseCases(deps: ReviewUseCaseDeps) {
  const { db, requireProject } = deps

  async function findReviewOrThrow(reviewId: string) {
    const row = await findExternalReviewById(db, reviewId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '提审记录不存在')
    return row
  }

  /**
   * 创建一次提审记录；审核状态从待审核开始，重新提审总是新增记录。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param input 提审对象、版本、平台、提交时间、说明与证据。
   * @returns 新建的提审视图。
   * @throws 无写权限、服务停用或参数不合法时抛出 ApiError。
   */
  async function createReview(actor: SessionUser, projectId: string, input: CreateReviewInput): Promise<ReviewView> {
    const context = await requireProject(actor, projectId, true)
    const targetType = validateReviewTargetType(input.targetType)
    const versionLabel = requireText(input.versionLabel, '版本标识', 200)
    const reviewPlatform = requireText(input.reviewPlatform, '提审平台', 120)
    const submittedAt = validateTimestamp(input.submittedAt, '提交时间')
    const note = optionalText(input.note, '说明', 1000)
    const evidenceUrl = input.evidenceUrl ? validateExternalUrl(input.evidenceUrl, '证据地址') : null
    const service =
      input.serviceId === undefined || input.serviceId === null
        ? null
        : await requireActiveProjectService(db, projectId, input.serviceId)
    const reviewId = randomUUID()
    await db.transaction(async (tx) => {
      await insertExternalReview(tx, {
        id: reviewId,
        teamId: context.teamId,
        projectId,
        serviceId: service ? service.id : null,
        targetType,
        versionLabel,
        reviewPlatform,
        submittedAt,
        submittedByUserId: actor.id,
        note,
        evidenceUrl,
      })
      await appendActivity(tx, {
        teamId: context.teamId,
        projectId,
        entityType: 'external_review',
        entityId: reviewId,
        action: 'external_review_created',
        actorUserId: actor.id,
        changes: { targetType, versionLabel, reviewPlatform },
      })
    })
    return toReviewView(await findReviewOrThrow(reviewId))
  }

  /**
   * 更新审核状态、原因、审核时间与证据；保留原提审事实，不自动同步外部平台。
   * @param actor 当前登录用户。
   * @param reviewId 提审标识。
   * @param input 目标状态、原因、审核时间、证据与乐观锁版本。
   * @returns 更新后的提审视图。
   * @throws 无写权限、版本冲突、非法流转或参数不合法时抛出 ApiError。
   */
  async function updateReview(actor: SessionUser, reviewId: string, input: UpdateReviewInput): Promise<ReviewView> {
    const existing = await findReviewOrThrow(reviewId)
    const context = await requireProject(actor, existing.project_id, true)
    const nextStatus = validateReviewStatus(input.reviewStatus)
    const currentStatus = toReviewStatus(existing.review_status)
    assertReviewStatusTransition(currentStatus, nextStatus)
    if (existing.version !== input.version) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '提审记录已被其他操作修改，请刷新后重试')
    }
    const reviewReason =
      input.reviewReason === undefined
        ? existing.review_reason
        : input.reviewReason === null
          ? null
          : validateReason(input.reviewReason)
    if ((nextStatus === 'rejected' || nextStatus === 'withdrawn') && !reviewReason) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '拒绝或撤回审核必须填写原因')
    }
    const evidenceUrl =
      input.evidenceUrl === undefined
        ? existing.evidence_url
        : input.evidenceUrl === null
          ? null
          : validateExternalUrl(input.evidenceUrl, '证据地址')
    const reviewedAt =
      input.reviewedAt === undefined
        ? existing.reviewed_at
        : input.reviewedAt === null
          ? null
          : validateTimestamp(input.reviewedAt, '审核时间')
    await db.transaction(async (tx) => {
      const updated = await updateExternalReview(tx, reviewId, input.version, {
        reviewStatus: nextStatus,
        reviewReason,
        reviewedAt,
        evidenceUrl,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '提审记录已被其他操作修改，请刷新后重试')
      await appendActivity(tx, {
        teamId: context.teamId,
        projectId: existing.project_id,
        entityType: 'external_review',
        entityId: reviewId,
        action: 'external_review_updated',
        actorUserId: actor.id,
        ...(reviewReason === null ? {} : { reason: reviewReason }),
        changes: { previousStatus: currentStatus, reviewStatus: nextStatus },
      })
    })
    return toReviewView(await findReviewOrThrow(reviewId))
  }

  /**
   * 读取提审详情。
   * @param actor 当前登录用户。
   * @param reviewId 提审标识。
   * @returns 提审视图。
   * @throws 提审不存在时抛出 NOT_FOUND；无团队权限时抛出 FORBIDDEN。
   */
  async function getReview(actor: SessionUser, reviewId: string): Promise<ReviewView> {
    const row = await findReviewOrThrow(reviewId)
    await requireProject(actor, row.project_id, false)
    return toReviewView(row)
  }

  /**
   * 分页查询项目提审记录。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param filters 服务、对象类型、审核状态与分页条件。
   * @returns 提审分页，按提交时间倒序。
   * @throws 项目不存在或无团队权限时抛出 ApiError；筛选或分页不合法时抛出 VALIDATION_ERROR。
   */
  async function listReviews(
    actor: SessionUser,
    projectId: string,
    filters: ReviewListQuery,
  ): Promise<PageView<ReviewView>> {
    await requireProject(actor, projectId, false)
    validatePage(filters.page, filters.pageSize)
    const repositoryFilters: ReviewListFilters = {
      serviceId: filters.serviceId,
      targetType: filters.targetType ? validateReviewTargetType(filters.targetType) : undefined,
      reviewStatus: filters.reviewStatus ? validateReviewStatus(filters.reviewStatus) : undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    }
    const { rows, total } = await findExternalReviews(db, projectId, repositoryFilters)
    return pageView(rows.map(toReviewView), filters.page, filters.pageSize, total)
  }

  return { createReview, updateReview, getReview, listReviews }
}
