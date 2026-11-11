import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { activity, comment } from './collaboration.tables.ts'

/** 数据所有者可传入根连接或同一事务连接。 */
type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DatabaseExecutor = Pick<Database, 'insert' | 'select'> | TransactionDatabase

export type CommentEntityType = 'project' | 'requirement' | 'bug'
export type ActivityEntityType =
  | CommentEntityType
  | 'code_reference'
  | 'team_member'
  | 'team'
  | 'project_service'
  | 'build_record'
  | 'build_artifact'
  | 'service_run_version'
  | 'pipeline_run'
  | 'pipeline_node'
  | 'external_review'
  | 'release_result'
  | 'credential'
  | 'credential_grant'
  | 'project_env_var'
  | 'skill'
  | 'agent_template'
  | 'attachment'

export interface NewComment {
  id: string
  teamId: string
  projectId: string | null
  entityType: CommentEntityType
  entityId: string
  authorUserId: string
  bodyMarkdown: string
}

export interface NewActivity {
  id: string
  teamId: string
  projectId: string | null
  entityType: ActivityEntityType
  entityId: string
  action: string
  actorUserId: string
  changes?: Record<string, unknown>
  reason?: string
  note?: string
}

/**
 * 插入评论。
 * @param executor 根连接或同一业务事务。
 * @param input 已校验的评论文本及归属。
 * @returns 新评论行。
 */
export async function insertComment(executor: DatabaseExecutor, input: NewComment) {
  const [row] = await executor
    .insert(comment)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      author_user_id: input.authorUserId,
      body_markdown: input.bodyMarkdown,
    })
    .returning()
  if (!row) throw new Error('评论写入失败')
  return row
}

/**
 * 插入活动记录。
 * @param executor 根连接或同一业务事务。
 * @param input 已校验的活动内容。
 * @returns 新活动行。
 */
export async function insertActivity(executor: DatabaseExecutor, input: NewActivity) {
  const [row] = await executor
    .insert(activity)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      actor_user_id: input.actorUserId,
      changes: input.changes ?? null,
      reason: input.reason ?? null,
      note: input.note ?? null,
    })
    .returning()
  if (!row) throw new Error('活动写入失败')
  return row
}

/**
 * 按事项读取评论分页，按时间升序。
 * @param executor 数据库连接。
 * @param entityType 事项类型。
 * @param entityId 事项标识。
 * @param page 页码，从 1 开始。
 * @param pageSize 每页数量。
 * @returns 评论行与总数。
 */
export async function findComments(
  executor: DatabaseExecutor,
  entityType: CommentEntityType,
  entityId: string,
  page: number,
  pageSize: number,
) {
  const where = and(eq(comment.entity_type, entityType), eq(comment.entity_id, entityId))
  const [rows, [total]] = await Promise.all([
    executor
      .select()
      .from(comment)
      .where(where)
      .orderBy(asc(comment.created_at), asc(comment.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    executor.select({ value: count() }).from(comment).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/**
 * 按事项读取活动分页，按时间倒序、ID 倒序。
 * @param executor 数据库连接。
 * @param entityType 事项类型。
 * @param entityId 事项标识。
 * @param page 页码，从 1 开始。
 * @param pageSize 每页数量。
 * @returns 活动行与总数。
 */
export async function findActivities(
  executor: DatabaseExecutor,
  entityType: ActivityEntityType,
  entityId: string,
  page: number,
  pageSize: number,
) {
  const where = and(eq(activity.entity_type, entityType), eq(activity.entity_id, entityId))
  const [rows, [total]] = await Promise.all([
    executor
      .select()
      .from(activity)
      .where(where)
      .orderBy(desc(activity.created_at), desc(activity.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    executor.select({ value: count() }).from(activity).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}
