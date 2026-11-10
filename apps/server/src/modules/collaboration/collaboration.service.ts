import { randomUUID } from 'node:crypto'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import {
  findActivities,
  findComments,
  insertActivity,
  insertComment,
  type ActivityEntityType,
  type CommentEntityType,
  type DatabaseExecutor,
} from './collaboration.repository.ts'

const COMMENT_ENTITY_TYPES: ReadonlySet<string> = new Set(['project', 'requirement', 'bug'])
const ACTIVITY_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'project',
  'requirement',
  'bug',
  'code_reference',
  'team_member',
  'team',
  'project_service',
  'build_record',
  'build_artifact',
  'service_run_version',
  'pipeline_run',
  'external_review',
  'release_result',
  'credential',
  'credential_grant',
  'project_env_var',
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

/** 将数据库评论目标类型收窄为业务类型；数据不合法时说明是持久化异常。 */
function toCommentEntityType(value: string): CommentEntityType {
  if (!isCommentEntityType(value)) throw new Error(`数据库评论目标类型不合法: ${value}`)
  return value
}

/** 将数据库活动目标类型收窄为业务类型；数据不合法时说明是持久化异常。 */
function toActivityEntityType(value: string): ActivityEntityType {
  if (!isActivityEntityType(value)) throw new Error(`数据库活动目标类型不合法: ${value}`)
  return value
}

/** 判断字符串是否为评论目标类型。 */
function isCommentEntityType(value: string): value is CommentEntityType {
  return COMMENT_ENTITY_TYPES.has(value)
}

/** 判断字符串是否为活动目标类型。 */
function isActivityEntityType(value: string): value is ActivityEntityType {
  return ACTIVITY_ENTITY_TYPES.has(value)
}

function validateCommentEntityType(value: string): CommentEntityType {
  if (!isCommentEntityType(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '评论目标类型不合法')
  return value
}

function validateActivityEntityType(value: string): ActivityEntityType {
  if (!isActivityEntityType(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '活动目标类型不合法')
  return value
}

function mapComment(row: ReturnType<typeof insertComment> extends Promise<infer T> ? T : never): CommentView {
  return {
    id: row.id,
    teamId: row.team_id,
    projectId: row.project_id,
    entityType: toCommentEntityType(row.entity_type),
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
    entityType: toActivityEntityType(row.entity_type),
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
  const entityType = validateActivityEntityType(input.entityType)
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
  const entityType = validateCommentEntityType(input.entityType)
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
  const type = validateCommentEntityType(entityType)
  const { rows, total } = await findComments(executor, type, entityId, page, pageSize)
  return {
    items: rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      projectId: row.project_id,
      entityType: toCommentEntityType(row.entity_type),
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
  const type = validateActivityEntityType(entityType)
  const { rows, total } = await findActivities(executor, type, entityId, page, pageSize)
  return {
    items: rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      projectId: row.project_id,
      entityType: toActivityEntityType(row.entity_type),
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
