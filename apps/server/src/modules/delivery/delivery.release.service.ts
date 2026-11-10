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
  findReleaseResultById,
  findReleaseResults,
  insertReleaseResult,
} from './delivery.review.repository.ts'
import type { ReleaseListFilters } from './delivery.review.repository.ts'
import {
  optionalText,
  requireText,
  validateExternalUrl,
  validateReleaseStatus,
  validateTimestamp,
} from './delivery.validators.ts'
import { pageView, toReleaseView, type PageView, type ReleaseView } from './delivery.view.ts'

/** 记录实际发布结果的请求体。 */
export interface CreateReleaseInput {
  reviewId?: string | null
  serviceId?: string | null
  versionLabel: string
  releaseStatus: string
  releasedAt?: string | null
  scopeNote?: string | null
  evidenceUrl?: string | null
  version?: number
}

/** 发布结果列表筛选与分页条件。 */
export interface ReleaseListQuery {
  serviceId?: string
  releaseStatus?: string
  reviewId?: string
  page: number
  pageSize: number
}

export interface ReleaseUseCaseDeps {
  db: Database
  requireProject: RequireProjectAccess
}

/**
 * 创建实际发布结果用例。
 * @param deps 数据库连接与项目访问校验。
 * @returns 发布结果记录与查询用例；审核通过不自动生成记录。
 */
export function createReleaseUseCases(deps: ReleaseUseCaseDeps) {
  const { db, requireProject } = deps

  /**
   * 记录实际发布结果；审核通过不会自动生成发布记录，发布也不推进审核状态。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param input 发布版本、状态、时间、范围、证据与可选关联提审。
   * @returns 新建的发布结果视图。
   * @throws 无写权限、关联提审不属于当前项目或参数不合法时抛出 ApiError。
   */
  async function createRelease(actor: SessionUser, projectId: string, input: CreateReleaseInput): Promise<ReleaseView> {
    const context = await requireProject(actor, projectId, true)
    const versionLabel = requireText(input.versionLabel, '版本标识', 200)
    const releaseStatus = validateReleaseStatus(input.releaseStatus)
    const releasedAt = input.releasedAt ? validateTimestamp(input.releasedAt, '发布时间') : null
    const scopeNote = optionalText(input.scopeNote, '发布范围说明', 1000)
    const evidenceUrl = input.evidenceUrl ? validateExternalUrl(input.evidenceUrl, '证据地址') : null
    const service =
      input.serviceId === undefined || input.serviceId === null
        ? null
        : await requireActiveProjectService(db, projectId, input.serviceId)
    if (input.reviewId !== undefined && input.reviewId !== null) {
      const review = await findExternalReviewById(db, input.reviewId)
      if (!review || review.project_id !== projectId) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联提审记录不属于当前项目')
      }
    }
    const initialVersion = input.version ?? 1
    if (!Number.isSafeInteger(initialVersion) || initialVersion < 1) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '发布记录版本不合法')
    }
    const releaseId = randomUUID()
    await db.transaction(async (tx) => {
      const row = await insertReleaseResult(tx, {
        id: releaseId,
        teamId: context.teamId,
        projectId,
        reviewId: input.reviewId ?? null,
        serviceId: service ? service.id : null,
        versionLabel,
        releaseStatus,
        releasedAt,
        scopeNote,
        evidenceUrl,
        version: initialVersion,
        recordedByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId: context.teamId,
        projectId,
        entityType: 'release_result',
        entityId: row.id,
        action: 'release_result_recorded',
        actorUserId: actor.id,
        changes: { versionLabel, releaseStatus },
      })
    })
    const inserted = await findReleaseResultById(db, releaseId)
    if (!inserted) throw new Error('发布结果写入后读取失败')
    return toReleaseView(inserted)
  }

  /**
   * 分页查询项目发布结果。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param filters 服务、发布状态、关联提审与分页条件。
   * @returns 发布结果分页，发布时间为空的记录排在最后。
   * @throws 项目不存在或无团队权限时抛出 ApiError；筛选或分页不合法时抛出 VALIDATION_ERROR。
   */
  async function listReleases(
    actor: SessionUser,
    projectId: string,
    filters: ReleaseListQuery,
  ): Promise<PageView<ReleaseView>> {
    await requireProject(actor, projectId, false)
    validatePage(filters.page, filters.pageSize)
    const repositoryFilters: ReleaseListFilters = {
      serviceId: filters.serviceId,
      releaseStatus: filters.releaseStatus ? validateReleaseStatus(filters.releaseStatus) : undefined,
      reviewId: filters.reviewId,
      page: filters.page,
      pageSize: filters.pageSize,
    }
    const { rows, total } = await findReleaseResults(db, projectId, repositoryFilters)
    return pageView(rows.map(toReleaseView), filters.page, filters.pageSize, total)
  }

  return { createRelease, listReleases }
}
