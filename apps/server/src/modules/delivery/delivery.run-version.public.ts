import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { requireActiveProjectService } from './delivery.access.ts'
import type { DeliveryExecutor } from './delivery.repository.ts'
import { isUniqueConstraintError } from './delivery.errors.ts'
import {
  findRunVersion,
  insertRunVersion,
  insertRunVersionChange,
  updateRunVersion,
} from './delivery.run-version.repository.ts'
import { requireText, validateEnvironment, validateReason } from './delivery.validators.ts'
import { toRunVersionView, type RunVersionView } from './delivery.view.ts'

/** 部署验证通过后写入运行版本的输入；调用方在同一事务内保证计划完成与版本更新同时生效。 */
export interface ApplyDeploymentVersionInput {
  teamId: string
  projectId: string
  serviceId: string
  environment: string
  versionLabel: string
  /** 证据地址；通常为变更计划详情路径，由调用方拼接。 */
  evidenceUrl: string | null
  /** 写入运行版本变化历史的原因，必须包含计划标识。 */
  reason: string
  actorUserId: string
}

/**
 * 创建“部署验证通过后更新运行版本”的公开用例。
 * @param deps 数据库连接。
 * @returns 供 operations 模块在验证事务内调用的写入函数。
 * @remarks 只接受已确认的部署结果；不替代人工确认路径，也不允许调用方跳过权限校验。
 */
export function createDeploymentRunVersionWriter(deps: { db: Database }) {
  const { db } = deps

  /**
   * 将部署验证结果写入服务运行版本，并记录变化历史与活动。
   * @param input 团队、项目、服务、环境、版本与计划证据。
   * @returns 更新后的运行版本视图。
   * @throws 服务不存在、服务不属于项目或并发版本冲突时抛出业务错误。
   */
  async function applyDeploymentRunVersion(
    input: ApplyDeploymentVersionInput,
    executor?: DeliveryExecutor,
  ): Promise<RunVersionView> {
    const environment = validateEnvironment(input.environment)
    const versionLabel = requireText(input.versionLabel, '版本标识', 200)
    const reason = validateReason(input.reason)
    const service = await requireActiveProjectService(db, input.projectId, input.serviceId)
    if (service.team_id !== input.teamId) throw new ApiError(ERROR_CODES.FORBIDDEN, '服务不属于当前团队')
    const existing = await findRunVersion(db, service.id, environment)
    const recordId = existing?.id ?? randomUUID()
    const confirmedAt = new Date()
    const write = async (tx: DeliveryExecutor) => {
      if (existing) {
        const updated = await updateRunVersion(tx, existing.id, existing.version, {
          versionLabel,
          source: 'deployment_receipt',
          evidenceUrl: input.evidenceUrl,
          verificationStatus: 'confirmed',
          confirmedByUserId: input.actorUserId,
          confirmedAt,
        })
        if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '运行版本已被其他操作修改，请刷新后重试')
      } else {
        await insertRunVersion(tx, {
          id: recordId,
          teamId: input.teamId,
          projectId: input.projectId,
          serviceId: service.id,
          environment,
          versionLabel,
          source: 'deployment_receipt',
          evidenceUrl: input.evidenceUrl,
          verificationStatus: 'confirmed',
          confirmedByUserId: input.actorUserId,
          confirmedAt,
        })
      }
      await insertRunVersionChange(tx, {
        id: randomUUID(),
        teamId: input.teamId,
        projectId: input.projectId,
        serviceId: service.id,
        environment,
        previousVersionLabel: existing?.version_label ?? null,
        newVersionLabel: versionLabel,
        previousStatus: existing?.verification_status ?? 'unknown',
        newStatus: 'confirmed',
        source: 'deployment_receipt',
        evidenceUrl: input.evidenceUrl,
        reason,
        changedByUserId: input.actorUserId,
      })
      await appendActivity(tx, {
        teamId: input.teamId,
        projectId: input.projectId,
        entityType: 'service_run_version',
        entityId: recordId,
        action: existing ? 'service_run_version_corrected' : 'service_run_version_confirmed',
        actorUserId: input.actorUserId,
        reason,
        changes: {
          environment,
          previousVersionLabel: existing?.version_label ?? null,
          newVersionLabel: versionLabel,
          previousStatus: existing?.verification_status ?? 'unknown',
          newStatus: 'confirmed',
        },
      })
    }
    try {
      if (executor) await write(executor)
      else await db.transaction(write)
    } catch (error) {
      if (!existing && isUniqueConstraintError(error)) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '运行版本已被其他操作修改，请刷新后重试')
      }
      throw error
    }
    // 复用调用方事务时必须从事务读取，否则提交前看不到刚写入的行。
    const reader = executor ?? db
    const row = await findRunVersion(reader, service.id, environment)
    if (!row) throw new Error('运行版本写入后读取失败')
    return toRunVersionView(row)
  }

  return { applyDeploymentRunVersion }
}
