import { and, asc, count, eq, inArray, lt, ne } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { project } from '../projects/projects.tables.ts'
import { attachment, type AttachmentTargetType } from './attachments.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type AttachmentExecutor = Database | TransactionDatabase
/** 事务连接；绑定与解绑必须在业务事务内执行。 */
export type AttachmentTransaction = TransactionDatabase

/** 附件记录行。 */
export type AttachmentRow = typeof attachment.$inferSelect

/** 清理任务需要的附件定位投影。 */
export interface AttachmentObjectRef {
  id: string
  bucket_id: string
  storage_key: string
}

/** 新建临时附件的输入。 */
export interface NewAttachment {
  id: string
  teamId: string
  projectId: string
  bucketId: string
  storageKey: string
  fileName: string
  sizeBytes: number
  contentType: string | null
  sha256: string
  uploadedByUserId: string
}

/**
 * 按标识查找附件。
 * @param executor 数据库连接或事务。
 * @param attachmentId 附件标识。
 * @returns 附件行；不存在时返回 undefined。
 */
export async function findAttachmentById(
  executor: AttachmentExecutor,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const [row] = await executor.select().from(attachment).where(eq(attachment.id, attachmentId)).limit(1)
  return row
}

/**
 * 批量按标识查找附件。
 * @param executor 数据库连接或事务。
 * @param attachmentIds 附件标识集合；重复项由调用方先去重。
 * @returns 找到的附件行，顺序不保证；空集合直接返回空数组。
 */
export async function findAttachmentsByIds(
  executor: AttachmentExecutor,
  attachmentIds: string[],
): Promise<AttachmentRow[]> {
  if (attachmentIds.length === 0) return []
  return executor.select().from(attachment).where(inArray(attachment.id, attachmentIds))
}

/**
 * 插入临时附件记录。
 * @param executor 数据库连接或事务。
 * @param input 对象定位、文件元信息与上传者。
 * @returns 新附件行，状态为 temp。
 */
export async function insertAttachment(executor: AttachmentExecutor, input: NewAttachment): Promise<AttachmentRow> {
  const [row] = await executor
    .insert(attachment)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      bucket_id: input.bucketId,
      storage_key: input.storageKey,
      file_name: input.fileName,
      size_bytes: input.sizeBytes,
      content_type: input.contentType,
      sha256: input.sha256,
      uploaded_by_user_id: input.uploadedByUserId,
    })
    .returning()
  if (!row) throw new Error('附件记录写入失败')
  return row
}

/**
 * 将临时附件绑定到业务目标。
 * @param executor 事务连接。
 * @param input 附件标识与目标。
 * @returns 更新后的附件行；附件已不是 temp 时返回 undefined，由调用方判定冲突。
 * @remarks 以 status='temp' 作为条件更新，与清理任务并发时只有一方成功。
 */
export async function bindAttachment(
  executor: AttachmentExecutor,
  input: { attachmentId: string; targetType: AttachmentTargetType; targetId: string },
): Promise<AttachmentRow | undefined> {
  const now = new Date()
  const [row] = await executor
    .update(attachment)
    .set({
      status: 'bound',
      target_type: input.targetType,
      target_id: input.targetId,
      bound_at: now,
      updated_at: now,
    })
    .where(and(eq(attachment.id, input.attachmentId), eq(attachment.status, 'temp')))
    .returning()
  return row
}

/**
 * 将附件标记为待删除。
 * @param executor 事务连接。
 * @param attachmentId 附件标识。
 * @returns 更新后的附件行；附件已删除时返回 undefined。
 * @remarks 条件更新排除已 removed 的记录，保证删除动作只生效一次。
 */
export async function markAttachmentRemoved(
  executor: AttachmentExecutor,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const [row] = await executor
    .update(attachment)
    .set({ status: 'removed', updated_at: new Date() })
    .where(and(eq(attachment.id, attachmentId), ne(attachment.status, 'removed')))
    .returning()
  return row
}

/**
 * 删除仍处于 temp 的附件记录。
 * @param executor 事务连接。
 * @param attachmentId 附件标识。
 * @returns 被删除的附件行；已被绑定或删除时返回 undefined。
 * @remarks 数据库约束要求 removed 记录必须带业务目标，因此未绑定的临时附件只能直接硬删除；
 * 对象删除在事务提交后执行，失败会留下孤儿对象并记录告警。
 */
export async function deleteTempAttachmentRecord(
  executor: AttachmentTransaction,
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const [row] = await executor
    .delete(attachment)
    .where(and(eq(attachment.id, attachmentId), eq(attachment.status, 'temp')))
    .returning()
  return row
}

/**
 * 按业务目标列出已绑定附件。
 * @param executor 数据库连接或事务。
 * @param targetType 目标类型。
 * @param targetId 目标标识。
 * @returns 按创建时间升序排列的已绑定附件行；不包含 temp 与 removed。
 */
export async function findBoundAttachments(
  executor: AttachmentExecutor,
  targetType: AttachmentTargetType,
  targetId: string,
): Promise<AttachmentRow[]> {
  return executor
    .select()
    .from(attachment)
    .where(
      and(eq(attachment.target_type, targetType), eq(attachment.target_id, targetId), eq(attachment.status, 'bound')),
    )
    .orderBy(asc(attachment.created_at), asc(attachment.id))
}

/**
 * 统计业务目标已绑定的附件数量，用于单记录上限校验。
 * @param executor 数据库连接或事务。
 * @param targetType 目标类型。
 * @param targetId 目标标识。
 * @returns 已绑定附件数量。
 */
export async function countBoundAttachments(
  executor: AttachmentExecutor,
  targetType: AttachmentTargetType,
  targetId: string,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(attachment)
    .where(
      and(eq(attachment.target_type, targetType), eq(attachment.target_id, targetId), eq(attachment.status, 'bound')),
    )
  return row?.value ?? 0
}

/**
 * 统计引用某储存桶的附件记录数。
 * @param executor 数据库连接或事务。
 * @param bucketId 储存桶标识。
 * @returns 附件记录数；包含 removed 记录，因为其对象可能仍待清理，删除桶前必须一并处理。
 */
export async function countAttachmentsByBucket(executor: AttachmentExecutor, bucketId: string): Promise<number> {
  const [row] = await executor.select({ value: count() }).from(attachment).where(eq(attachment.bucket_id, bucketId))
  return row?.value ?? 0
}

/**
 * 查询超过保留期的临时附件候选。
 * @param executor 数据库连接或事务。
 * @param cutoff 保留期截止时间；created_at 早于该值的 temp 记录可清理。
 * @param limit 单轮最多读取行数，避免一次加载过多。
 * @returns 清理所需的对象定位与记录标识。
 */
export async function findExpiredTempAttachments(
  executor: AttachmentExecutor,
  cutoff: Date,
  limit: number,
): Promise<AttachmentObjectRef[]> {
  return executor
    .select({ id: attachment.id, bucket_id: attachment.bucket_id, storage_key: attachment.storage_key })
    .from(attachment)
    .where(and(eq(attachment.status, 'temp'), lt(attachment.created_at, cutoff)))
    .orderBy(asc(attachment.created_at), asc(attachment.id))
    .limit(limit)
}

/**
 * 认领并删除超期临时附件记录。
 * @param executor 事务连接。
 * @param input 附件标识与保留期截止时间。
 * @returns 是否删除成功；已被绑定或已被其他清理任务处理时返回 false。
 * @remarks 先条件删除记录再删除对象：对象删除失败只会留下孤儿对象，不会破坏已绑定附件。
 */
export async function deleteExpiredTempAttachment(
  executor: AttachmentTransaction,
  input: { attachmentId: string; cutoff: Date },
): Promise<boolean> {
  const rows = await executor
    .delete(attachment)
    .where(
      and(
        eq(attachment.id, input.attachmentId),
        eq(attachment.status, 'temp'),
        lt(attachment.created_at, input.cutoff),
      ),
    )
    .returning({ id: attachment.id })
  return rows.length > 0
}

/**
 * 查询待删除对象的 removed 附件。
 * @param executor 数据库连接或事务。
 * @param limit 单轮最多读取行数。
 * @returns 需要重试删除对象的附件定位。
 */
export async function findRemovedAttachments(
  executor: AttachmentExecutor,
  limit: number,
): Promise<AttachmentObjectRef[]> {
  return executor
    .select({ id: attachment.id, bucket_id: attachment.bucket_id, storage_key: attachment.storage_key })
    .from(attachment)
    .where(eq(attachment.status, 'removed'))
    .orderBy(asc(attachment.updated_at), asc(attachment.id))
    .limit(limit)
}

/**
 * 对象删除成功后删除 removed 附件记录。
 * @param executor 数据库连接或事务。
 * @param attachmentId 附件标识。
 * @returns 是否删除成功；记录已不存在或状态变化时返回 false。
 */
export async function deleteRemovedAttachment(executor: AttachmentExecutor, attachmentId: string): Promise<boolean> {
  const rows = await executor
    .delete(attachment)
    .where(and(eq(attachment.id, attachmentId), eq(attachment.status, 'removed')))
    .returning({ id: attachment.id })
  return rows.length > 0
}

/**
 * 读取项目负责人标识，供附件删除权限校验使用。
 * @param executor 数据库连接或事务。
 * @param projectId 项目标识。
 * @returns 负责人用户标识；项目不存在时返回 undefined。
 */
export async function findProjectOwnerUserId(
  executor: AttachmentExecutor,
  projectId: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ ownerUserId: project.owner_user_id })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  return row?.ownerUserId
}
