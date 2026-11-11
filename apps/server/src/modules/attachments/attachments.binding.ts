import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { findMembership } from '../identity/identity.repository.ts'
import { loadOwnerRefs, ownerRefOf } from '../identity/identity.display.ts'
import { assertSubmitAttachmentCount, type AttachmentPolicy } from './attachments.policy.ts'
import {
  bindAttachment,
  countBoundAttachments,
  findAttachmentsByIds,
  findBoundAttachments,
  findProjectOwnerUserId,
  markAttachmentRemoved,
  type AttachmentExecutor,
  type AttachmentRow,
  type AttachmentTransaction,
} from './attachments.repository.ts'
import type { AttachmentTargetType } from './attachments.tables.ts'
import type { AttachmentSummary } from './attachments.view.ts'
import { toAttachmentSummary } from './attachments.view.ts'

/** 绑定/解绑时当前操作者的最小身份信息；权限校验在用例内部完成。 */
export interface AttachmentBindingActor {
  userId: string
}

/** 单次绑定允许的策略子集；数量上限与临时附件保留期来自集中配置。 */
export type AttachmentBindingPolicy = Pick<
  AttachmentPolicy,
  'maxFilesPerSubmit' | 'maxFilesPerRecord' | 'tempRetentionHours'
>

/** 绑定临时附件到业务目标的输入。 */
export interface AttachmentBindRequest {
  teamId: string
  projectId: string
  targetType: AttachmentTargetType
  targetId: string
  /** 本次请求新增的临时附件标识，不是最终集合。 */
  attachmentIds: string[]
  actor: AttachmentBindingActor
  policy: AttachmentBindingPolicy
  /** 当前时间；测试可注入固定值，默认取系统时间。 */
  now?: Date
}

/** 记录更新时解绑最终集合中缺失附件的输入。 */
export interface AttachmentUnbindRequest {
  teamId: string
  projectId: string
  targetType: AttachmentTargetType
  targetId: string
  /** 更新请求中的最终附件集合；当前已绑定但不在其中的附件会被移除。 */
  keepAttachmentIds: string[]
  actor: AttachmentBindingActor
}

/** 附件删除权限判定结果。 */
export interface AttachmentDeleteAuthority {
  role: string
  /** 是否可删除任意附件：团队管理员或项目负责人。 */
  canDeleteAny: boolean
}

const TEMP_RETENTION_MESSAGE = '临时附件已超过保留期，请重新上传'
const TARGET_MISMATCH_MESSAGE = '附件不属于当前项目，无法绑定'
const CONCURRENT_STATE_MESSAGE = '附件状态已变化，请刷新后重试'

/**
 * 判定操作者是否可以删除指定项目的附件。
 * @param executor 数据库连接或事务。
 * @param input 团队、项目与操作者标识。
 * @returns 角色与"可删除任意附件"标记；上传者本人由调用方另行判断。
 * @throws 非正常团队成员时抛出 FORBIDDEN。
 * @remarks 删除权限口径：上传者本人、团队管理员或项目负责人；浏览者不具备删除权限。
 */
export async function resolveAttachmentDeleteAuthority(
  executor: AttachmentExecutor,
  input: { teamId: string; projectId: string; actorUserId: string },
): Promise<AttachmentDeleteAuthority> {
  const membership = await findMembership(executor, input.teamId, input.actorUserId)
  if (!membership || membership.status !== 'active') {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '无权访问该团队')
  }
  const projectOwnerUserId = await findProjectOwnerUserId(executor, input.projectId)
  return {
    role: membership.role,
    canDeleteAny: membership.role === 'admin' || projectOwnerUserId === input.actorUserId,
  }
}

function assertBindable(row: AttachmentRow, request: AttachmentBindRequest, expiresBeforeMs: number): void {
  if (row.status !== 'temp') {
    throw new ApiError(ERROR_CODES.ATTACHMENT_STATE_CONFLICT, `附件「${row.file_name}」不是待绑定的临时附件`)
  }
  if (row.uploaded_by_user_id !== request.actor.userId) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, `只能绑定本人上传的临时附件「${row.file_name}」`)
  }
  if (row.team_id !== request.teamId || row.project_id !== request.projectId) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, TARGET_MISMATCH_MESSAGE)
  }
  if (row.created_at.getTime() < expiresBeforeMs) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_STATE_CONFLICT, TEMP_RETENTION_MESSAGE)
  }
}

/**
 * 在业务事务内把临时附件绑定到需求或缺陷。
 * @param tx 业务事务连接；调用方负责提交，附件与业务记录必须同成同败。
 * @param request 目标、临时附件集合、操作者与数量策略。
 * @returns 绑定完成后无返回值。
 * @throws 附件不存在、非本人上传、跨项目、超过保留期、数量超限或并发状态冲突时抛出业务错误；整次绑定失败。
 * @remarks 每个附件单独写 `attachment_bound` 活动；activity.entityId 为附件标识，便于按附件追溯。
 */
export async function bindAttachments(tx: AttachmentTransaction, request: AttachmentBindRequest): Promise<void> {
  const attachmentIds = [...new Set(request.attachmentIds)]
  if (attachmentIds.length === 0) return

  const currentCount = await countBoundAttachments(tx, request.targetType, request.targetId)
  assertSubmitAttachmentCount(attachmentIds.length, currentCount, request.policy)

  const rows = await findAttachmentsByIds(tx, attachmentIds)
  if (rows.length !== attachmentIds.length) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '部分附件不存在或已被删除')
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const now = request.now ?? new Date()
  const expiresBeforeMs = now.getTime() - request.policy.tempRetentionHours * 60 * 60 * 1000

  for (const attachmentId of attachmentIds) {
    const row = rowsById.get(attachmentId)
    if (!row) throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    assertBindable(row, request, expiresBeforeMs)
    const bound = await bindAttachment(tx, {
      attachmentId,
      targetType: request.targetType,
      targetId: request.targetId,
    })
    if (!bound) throw new ApiError(ERROR_CODES.ATTACHMENT_STATE_CONFLICT, CONCURRENT_STATE_MESSAGE)
    await appendActivity(tx, {
      teamId: request.teamId,
      projectId: request.projectId,
      entityType: 'attachment',
      entityId: row.id,
      action: 'attachment_bound',
      actorUserId: request.actor.userId,
      changes: { targetType: request.targetType, targetId: request.targetId },
    })
  }
}

/**
 * 在业务事务内解绑最终集合中缺失的已绑定附件。
 * @param tx 业务事务连接。
 * @param request 目标、保留的附件集合与操作者。
 * @returns 解绑完成后无返回值；对象删除由 worker 清理任务在提交后重试。
 * @throws 无权删除他人附件、附件状态并发变化或非团队成员时抛出业务错误；整次更新失败。
 * @remarks 移除附件要求删除权限：上传者本人、团队管理员或项目负责人，不能借"最终集合"绕过。
 */
export async function unbindAttachments(tx: AttachmentTransaction, request: AttachmentUnbindRequest): Promise<void> {
  const keepIds = new Set(request.keepAttachmentIds)
  const boundRows = await findBoundAttachments(tx, request.targetType, request.targetId)
  const removableRows = boundRows.filter((row) => !keepIds.has(row.id))
  if (removableRows.length === 0) return

  const authority = await resolveAttachmentDeleteAuthority(tx, {
    teamId: request.teamId,
    projectId: request.projectId,
    actorUserId: request.actor.userId,
  })
  if (authority.role === 'viewer') throw new ApiError(ERROR_CODES.FORBIDDEN, '浏览者无权删除附件')
  for (const row of removableRows) {
    const isUploader = row.uploaded_by_user_id === request.actor.userId
    if (!authority.canDeleteAny && !isUploader) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, `无权删除他人上传的附件「${row.file_name}」`)
    }
  }

  for (const row of removableRows) {
    const removed = await markAttachmentRemoved(tx, row.id)
    if (!removed) throw new ApiError(ERROR_CODES.ATTACHMENT_STATE_CONFLICT, CONCURRENT_STATE_MESSAGE)
    await appendActivity(tx, {
      teamId: request.teamId,
      projectId: request.projectId,
      entityType: 'attachment',
      entityId: row.id,
      action: 'attachment_removed',
      actorUserId: request.actor.userId,
      changes: {
        fileName: row.file_name,
        sizeBytes: row.size_bytes,
        targetType: row.target_type,
        targetId: row.target_id,
      },
    })
  }
}

/** 已注入数量与保留期策略的绑定用例，供需求与缺陷服务按依赖注入使用。 */
export interface AttachmentBindingUseCases {
  /** 在业务事务内绑定临时附件；策略由工厂注入。 */
  bindAttachments(tx: AttachmentTransaction, input: Omit<AttachmentBindRequest, 'policy'>): Promise<void>
  /** 在业务事务内解绑最终集合中缺失的附件。 */
  unbindAttachments(tx: AttachmentTransaction, input: AttachmentUnbindRequest): Promise<void>
  /** 读取业务目标的已绑定附件摘要。 */
  listAttachmentsForTarget(
    executor: AttachmentExecutor,
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<AttachmentSummary[]>
}

/**
 * 创建绑定用例集合，把集中配置的数量与保留期策略绑定到用例上。
 * @param options 附件策略子集。
 * @returns 需求/缺陷模块可直接注入的绑定、解绑与列表用例。
 */
export function createAttachmentBinding(options: { policy: AttachmentBindingPolicy }): AttachmentBindingUseCases {
  return {
    bindAttachments: (tx, input) => bindAttachments(tx, { ...input, policy: options.policy }),
    unbindAttachments,
    listAttachmentsForTarget,
  }
}

/**
 * 读取业务目标已绑定的附件摘要。
 * @param executor 数据库连接或事务。
 * @param targetType 目标类型。
 * @param targetId 目标标识。
 * @returns 按上传时间升序的附件摘要；无附件时返回空数组。
 */
export async function listAttachmentsForTarget(
  executor: AttachmentExecutor,
  targetType: AttachmentTargetType,
  targetId: string,
): Promise<AttachmentSummary[]> {
  const rows = await findBoundAttachments(executor, targetType, targetId)
  if (rows.length === 0) return []
  const teamId = rows[0]?.team_id
  if (!teamId) throw new Error('附件缺少团队归属')
  const refs = await loadOwnerRefs(
    executor,
    teamId,
    rows.map((row) => row.uploaded_by_user_id),
  )
  return rows.map((row) => {
    const uploadedBy = ownerRefOf(row.uploaded_by_user_id, refs)
    if (!uploadedBy) throw new Error('附件上传者展示引用缺失')
    return toAttachmentSummary(row, uploadedBy)
  })
}
