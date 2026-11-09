import { randomUUID } from 'node:crypto'
import { ApiError } from '../../platform/http/errors.js'
import { ERROR_CODES } from '../../platform/http/error-codes.js'
import {
  findActivities,
  findComments,
  insertActivity,
  insertComment,
  type ActivityEntityType,
  type CommentEntityType,
  type DatabaseExecutor,
} from './collaboration.repository.js'

const COMMENT_ENTITY_TYPES = new Set<CommentEntityType>(['project', 'requirement', 'bug'])
const ACTIVITY_ENTITY_TYPES = new Set<ActivityEntityType>([
  'project',
  'requirement',
  'bug',
  'code_reference',
  'team_member',
])

export interface CommentView {
  id: string
  teamId: string
  projectId: string | null
  entityType: CommentEntityType
  entityId: string
  authorUserId: string
  bodyMarkdown: string
  createdAt: string
}

export interface ActivityView {
  id: string
  teamId: string
  projectId: string | null
  entityType: ActivityEntityType
  entityId: string
  action: string
  actorUserId: string
  changes: Record<string, unknown> | null
  reason: string | null
  note: string | null
  createdAt: string
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

function requireNonEmpty(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

function validateEntityType<T extends string>(value: string, allowed: Set<T>, name: string): T {
  if (!allowed.has(value as T)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不合法`)
  return value as T
}

function validatePage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '分页参数不合法')
  }
}

function mapComment(row: ReturnType<typeof insertComment> extends Promise<infer T> ? T : never): CommentView {
  return {
    id: row.id,
    teamId: row.team_id,
    projectId: row.project_id,
    entityType: row.entity_type as CommentEntityType,
    entityId: row.entity_id,
    authorUserId: row.author_user_id,
    bodyMarkdown: row.body_markdown,
    createdAt: row.created_at.toISOString(),
  }
}

function mapActivity(row: Awaited<ReturnType<typeof insertActivity>>): ActivityView {
  return {
    id: row.id,
    teamId: row.team_id,
    projectId: row.project_id,
    entityType: row.entity_type as ActivityEntityType,
    entityId: row.entity_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    changes: row.changes ?? null,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * 在当前事务中追加一条活动。
 * @param executor 根连接或业务事务，由调用模块传入。
 * @param input 活动目标、动作、操作者及可选原因/说明/变更快照。
 * @returns 新建的活动视图。
 * @throws 目标类型、动作或文本长度不合法时抛出 VALIDATION_ERROR。
 */
export async function appendActivity(
  executor: DatabaseExecutor,
  input: {
    teamId: string
    projectId?: string | null
    entityType: string
    entityId: string
    action: string
    actorUserId: string
    changes?: Record<string, unknown>
    reason?: string
    note?: string
  },
): Promise<ActivityView> {
  const entityType = validateEntityType(input.entityType, ACTIVITY_ENTITY_TYPES, '活动目标类型')
  const action = requireNonEmpty(input.action, '动作', 48)
  const reason = input.reason === undefined ? undefined : requireNonEmpty(input.reason, '原因', 2000)
  const note = input.note === undefined ? undefined : requireNonEmpty(input.note, '说明', 2000)
  const row = await insertActivity(executor, {
    id: randomUUID(),
    teamId: input.teamId,
    projectId: input.projectId ?? null,
    entityType,
    entityId: input.entityId,
    action,
    actorUserId: input.actorUserId,
    changes: input.changes,
    reason,
    note,
  })
  return mapActivity(row)
}

/**
 * 在当前事务中追加一条评论。
 * @param executor 根连接或业务事务，由调用模块传入。
 * @param input 评论目标、作者与 Markdown 正文。
 * @returns 新建评论视图。
 * @throws 目标类型或正文长度不合法时抛出 VALIDATION_ERROR。
 */
export async function addComment(
  executor: DatabaseExecutor,
  input: {
    teamId: string
    projectId?: string | null
    entityType: string
    entityId: string
    authorUserId: string
    bodyMarkdown: string
  },
): Promise<CommentView> {
  const entityType = validateEntityType(input.entityType, COMMENT_ENTITY_TYPES, '评论目标类型')
  const bodyMarkdown = requireNonEmpty(input.bodyMarkdown, '评论', 20_000)
  const row = await insertComment(executor, {
    id: randomUUID(),
    teamId: input.teamId,
    projectId: input.projectId ?? null,
    entityType,
    entityId: input.entityId,
    authorUserId: input.authorUserId,
    bodyMarkdown,
  })
  return mapComment(row)
}

/**
 * 按事项读取评论分页。
 * @param executor 数据库连接。
 * @param entityType 事项类型。
 * @param entityId 事项标识。
 * @param page 页码。
 * @param pageSize 每页数量，最大 100。
 * @returns 评论视图分页。
 * @throws 参数不合法时抛出 VALIDATION_ERROR。
 */
export async function listComments(
  executor: DatabaseExecutor,
  entityType: string,
  entityId: string,
  page = 1,
  pageSize = 20,
): Promise<PageResult<CommentView>> {
  validatePage(page, pageSize)
  const type = validateEntityType(entityType, COMMENT_ENTITY_TYPES, '评论目标类型')
  const { rows, total } = await findComments(executor, type, entityId, page, pageSize)
  return {
    items: rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      projectId: row.project_id,
      entityType: row.entity_type as CommentEntityType,
      entityId: row.entity_id,
      authorUserId: row.author_user_id,
      bodyMarkdown: row.body_markdown,
      createdAt: row.created_at.toISOString(),
    })),
    page,
    pageSize,
    total,
  }
}

/**
 * 按事项读取活动分页。
 * @param executor 数据库连接。
 * @param entityType 事项类型。
 * @param entityId 事项标识。
 * @param page 页码。
 * @param pageSize 每页数量，最大 100。
 * @returns 活动视图分页。
 * @throws 参数不合法时抛出 VALIDATION_ERROR。
 */
export async function listActivities(
  executor: DatabaseExecutor,
  entityType: string,
  entityId: string,
  page = 1,
  pageSize = 20,
): Promise<PageResult<ActivityView>> {
  validatePage(page, pageSize)
  const type = validateEntityType(entityType, ACTIVITY_ENTITY_TYPES, '活动目标类型')
  const { rows, total } = await findActivities(executor, type, entityId, page, pageSize)
  return {
    items: rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      projectId: row.project_id,
      entityType: row.entity_type as ActivityEntityType,
      entityId: row.entity_id,
      action: row.action,
      actorUserId: row.actor_user_id,
      changes: row.changes ?? null,
      reason: row.reason,
      note: row.note,
      createdAt: row.created_at.toISOString(),
    })),
    page,
    pageSize,
    total,
  }
}
