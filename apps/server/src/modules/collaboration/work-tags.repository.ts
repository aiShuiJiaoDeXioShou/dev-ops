import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import type { BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import { hasChatCredential } from '../bots/runtime/content.ts'
import { workTag, workTagLink } from './bot-conversations.tables.ts'
import type { WorkTagLinkInput, WorkTagView } from './work-tags.schema.ts'

type TagRow = typeof workTag.$inferSelect

/** 将标签记录转为公开字段，不向 UI 返回规范化检索值。 */
export function workTagView(row: TagRow): WorkTagView {
  return { id: row.id, name: row.name, updatedAt: row.updated_at.toISOString() }
}

/**
 * 清理用户或 Bot 提交的标签名称，计算团队内等价名称。
 * @param value 用户或模型看到的标签文字。
 * @returns 显示值与唯一键；空名称、超长和凭据形态拒绝保存。
 */
export function normalizeWorkTag(value: string) {
  const name = value.trim().replace(/\s+/gu, ' ')
  if (!name || name.length > 40 || hasChatCredential(name)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '标签应为 1 至 40 字符，且不能包含凭据')
  }
  return { name, normalized_name: name.normalize('NFKC').toLowerCase() }
}

/**
 * 在当前事务内创建或复用团队标签，并锁定标签避免关联时被删除。
 * @param tx 任务或人工标签修改事务。
 * @param teamId 标签所属团队。
 * @param value 标签的显示文字。
 * @returns 新建或已存在的标签行。
 */
export async function ensureWorkTag(tx: BotRunTransaction, teamId: string, value: string) {
  const name = normalizeWorkTag(value)
  const [created] = await tx
    .insert(workTag)
    .values({ team_id: teamId, ...name })
    .onConflictDoNothing({ target: [workTag.team_id, workTag.normalized_name] })
    .returning()
  if (created) return created
  const [existing] = await tx
    .select()
    .from(workTag)
    .where(and(eq(workTag.team_id, teamId), eq(workTag.normalized_name, name.normalized_name)))
    .for('key share')
  if (!existing) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '标签已被修改或删除，请重试')
  return existing
}

/**
 * 读取已授权的会话或任务上保存的标签。
 * @param database 数据库或当前事务。
 * @param teamId 会话团队。
 * @param input 已通过可见性校验的目标。
 * @returns 按标签名称排序的关联标签。
 */
export async function readTargetWorkTags(database: Pick<Database, 'select'>, teamId: string, input: WorkTagLinkInput) {
  const rows = await database
    .select({ tag: workTag })
    .from(workTagLink)
    .innerJoin(workTag, and(eq(workTag.id, workTagLink.tag_id), eq(workTag.team_id, workTagLink.team_id)))
    .where(
      and(
        eq(workTagLink.team_id, teamId),
        eq(workTagLink.target_kind, input.targetKind),
        eq(workTagLink.target_id, input.targetId),
      ),
    )
    .orderBy(asc(workTag.normalized_name), asc(workTag.id))
    .limit(100)
  return rows.map(({ tag }) => workTagView(tag))
}

/**
 * 使用 Bot 的整理结果关联任务标签；由调用者保证只在首次送验时执行。
 * @param tx 任务结果提交事务。
 * @param input 任务归属、执行者、标签文字。
 * @returns 忽略重复关联；名称不合法时回滚同一次任务提交。
 */
export async function linkBotResultTags(
  tx: BotRunTransaction,
  input: { teamId: string; taskId: string; botId: string; tags: readonly string[] },
) {
  const unique = new Map(input.tags.map((name) => [normalizeWorkTag(name).normalized_name, name]))
  for (const [, name] of [...unique].sort(([left], [right]) => left.localeCompare(right))) {
    const tag = await ensureWorkTag(tx, input.teamId, name)
    await tx
      .insert(workTagLink)
      .values({
        team_id: input.teamId,
        tag_id: tag.id,
        target_kind: 'task',
        target_id: input.taskId,
        linked_by_kind: 'bot',
        linked_by_id: input.botId,
      })
      .onConflictDoNothing({ target: [workTagLink.tag_id, workTagLink.target_kind, workTagLink.target_id] })
  }
}
