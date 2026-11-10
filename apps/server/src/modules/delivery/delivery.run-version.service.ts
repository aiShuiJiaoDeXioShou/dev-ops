import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { requireActiveProjectService, requireProjectService, type RequireProjectAccess } from './delivery.access.ts'
import { isUniqueConstraintError } from './delivery.errors.ts'
import {
  findRunVersion,
  findRunVersionChanges,
  findRunVersionsByService,
  insertRunVersion,
  insertRunVersionChange,
  updateRunVersion,
} from './delivery.run-version.repository.ts'
import {
  ENVIRONMENTS,
  requireText,
  validateEnvironment,
  validateExternalUrl,
  validateReason,
  validateRunVersionSource,
  validateVerificationStatus,
} from './delivery.validators.ts'
import {
  emptyRunVersionView,
  pageView,
  toRunVersionChangeView,
  toRunVersionView,
  type PageView,
  type RunVersionChangeView,
  type RunVersionView,
} from './delivery.view.ts'

/** 确认或更正运行版本的请求体；version 为乐观锁，缺失按冲突处理。 */
export interface ConfirmRunVersionInput {
  versionLabel: string
  source: string
  evidenceUrl?: string | null
  verificationStatus: string
  reason?: string | null
  version?: number
}

export interface RunVersionUseCaseDeps {
  db: Database
  requireProject: RequireProjectAccess
}

/**
 * 创建服务运行版本用例。
 * @param deps 数据库连接与项目访问校验。
 * @returns 按服务/环境读取当前版本、读取历史与确认/更正用例。
 */
export function createRunVersionUseCases(deps: RunVersionUseCaseDeps) {
  const { db, requireProject } = deps

  /**
   * 读取服务各预置环境的当前运行版本；无记录的环境返回未知视图而不是最新构建。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param serviceId 服务标识。
   * @returns 固定顺序的开发、测试、生产三个视图。
   * @throws 项目或服务不存在、无团队权限时抛出 ApiError。
   */
  async function listRunVersions(actor: SessionUser, projectId: string, serviceId: string): Promise<RunVersionView[]> {
    await requireProject(actor, projectId, false)
    const service = await requireProjectService(db, projectId, serviceId)
    const rows = await findRunVersionsByService(db, service.id)
    const byEnvironment = new Map(rows.map((row) => [row.environment, row]))
    return ENVIRONMENTS.map((environment) => {
      const row = byEnvironment.get(environment)
      return row ? toRunVersionView(row) : emptyRunVersionView(service.id, environment)
    })
  }

  /**
   * 读取某服务某环境的运行版本变化历史。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param serviceId 服务标识。
   * @param environment 环境标识。
   * @param page 页码，从 1 开始。
   * @param pageSize 每页数量。
   * @returns 变化历史分页，按变化时间倒序。
   * @throws 项目、服务或环境不合法时抛出 ApiError；分页参数不合法时抛出 VALIDATION_ERROR。
   */
  async function listRunVersionHistory(
    actor: SessionUser,
    projectId: string,
    serviceId: string,
    environment: string,
    page: number,
    pageSize: number,
  ): Promise<PageView<RunVersionChangeView>> {
    await requireProject(actor, projectId, false)
    const service = await requireProjectService(db, projectId, serviceId)
    const typedEnvironment = validateEnvironment(environment)
    validatePage(page, pageSize)
    const { rows, total } = await findRunVersionChanges(db, service.id, typedEnvironment, page, pageSize)
    return pageView(rows.map(toRunVersionChangeView), page, pageSize, total)
  }

  /**
   * 确认或更正某服务某环境的运行版本；新构建与产物不会自动调用此用例。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param serviceId 服务标识。
   * @param environment 环境标识。
   * @param input 版本标识、来源、证据、核对状态、可选原因与乐观锁版本。
   * @returns 更新后的运行版本视图。
   * @throws 无写权限、服务停用、版本冲突或参数不合法时抛出 ApiError。
   */
  async function confirmRunVersion(
    actor: SessionUser,
    projectId: string,
    serviceId: string,
    environment: string,
    input: ConfirmRunVersionInput,
  ): Promise<RunVersionView> {
    const typedEnvironment = validateEnvironment(environment)
    const context = await requireProject(actor, projectId, true)
    const service = await requireActiveProjectService(db, projectId, serviceId)
    if (input.version === undefined) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '缺少乐观锁版本，请刷新后重试')
    const expectedVersion = input.version
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '乐观锁版本不合法')
    }
    const versionLabel = requireText(input.versionLabel, '版本标识', 200)
    const source = validateRunVersionSource(input.source)
    const evidenceUrl = input.evidenceUrl ? validateExternalUrl(input.evidenceUrl, '证据地址') : null
    const verificationStatus = validateVerificationStatus(input.verificationStatus)
    const reason = input.reason === null || input.reason === undefined ? null : validateReason(input.reason)
    const existing = await findRunVersion(db, service.id, typedEnvironment)
    if (!existing && expectedVersion !== 0) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '运行版本尚未记录，请刷新后重试')
    }
    if (existing && existing.version !== expectedVersion) {
      throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '运行版本已被其他操作修改，请刷新后重试')
    }
    const isChanged =
      !existing ||
      existing.version_label !== versionLabel ||
      existing.source !== source ||
      existing.evidence_url !== evidenceUrl ||
      existing.verification_status !== verificationStatus
    if (existing && existing.verification_status === 'confirmed' && isChanged && !reason) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '更正已确认的运行版本必须填写原因')
    }
    const confirmedByUserId = verificationStatus === 'confirmed' ? actor.id : null
    const confirmedAt = verificationStatus === 'confirmed' ? new Date() : null
    const recordId = existing?.id ?? randomUUID()
    try {
      await db.transaction(async (tx) => {
        if (existing) {
          const updated = await updateRunVersion(tx, existing.id, expectedVersion, {
            versionLabel,
            source,
            evidenceUrl,
            verificationStatus,
            confirmedByUserId,
            confirmedAt,
          })
          if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '运行版本已被其他操作修改，请刷新后重试')
        } else {
          await insertRunVersion(tx, {
            id: recordId,
            teamId: context.teamId,
            projectId,
            serviceId: service.id,
            environment: typedEnvironment,
            versionLabel,
            source,
            evidenceUrl,
            verificationStatus,
            confirmedByUserId,
            confirmedAt,
          })
        }
        await insertRunVersionChange(tx, {
          id: randomUUID(),
          teamId: context.teamId,
          projectId,
          serviceId: service.id,
          environment: typedEnvironment,
          previousVersionLabel: existing?.version_label ?? null,
          newVersionLabel: versionLabel,
          previousStatus: existing?.verification_status ?? 'unknown',
          newStatus: verificationStatus,
          source,
          evidenceUrl,
          reason,
          changedByUserId: actor.id,
        })
        await appendActivity(tx, {
          teamId: context.teamId,
          projectId,
          entityType: 'service_run_version',
          entityId: recordId,
          action: existing ? 'service_run_version_corrected' : 'service_run_version_confirmed',
          actorUserId: actor.id,
          ...(reason === null ? {} : { reason }),
          changes: {
            environment: typedEnvironment,
            previousVersionLabel: existing?.version_label ?? null,
            newVersionLabel: versionLabel,
            previousStatus: existing?.verification_status ?? 'unknown',
            newStatus: verificationStatus,
          },
        })
      })
    } catch (error) {
      // 并发首次确认可能同时通过存在性检查，唯一约束兜底并转换为业务冲突。
      if (!existing && isUniqueConstraintError(error)) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '运行版本已被其他操作修改，请刷新后重试')
      }
      throw error
    }
    const row = await findRunVersion(db, service.id, typedEnvironment)
    if (!row) throw new Error('运行版本写入后读取失败')
    return toRunVersionView(row)
  }

  return { listRunVersions, listRunVersionHistory, confirmRunVersion }
}
