import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { botSession, botSessionEntry } from '../bots/bots.session.tables.ts'
import type { BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import { botConversation, botMessage } from './bot-conversations.tables.ts'

type ReadDb = Pick<Database, 'select'>
type Room = Pick<typeof botConversation.$inferSelect, 'id' | 'team_id' | 'active_branch_id'>
type Message = typeof botMessage.$inferSelect

function roomScope(room: Room) {
  return and(eq(botMessage.team_id, room.team_id), eq(botMessage.conversation_id, room.id))
}

/**
 * 将私聊的活跃分支转换为房间消息查询条件，保留每个祖先分支在编辑前的前缀。
 * @param db 可读取会话记录的数据库或事务。
 * @param room 已获授权的会话与当前分支。
 * @returns 直接用于 botMessage 查询的房间与分支条件。
 * @throws 持久化分支包含无效关联时拒绝。
 */
export async function activeBotBranchScope(db: ReadDb, room: Room) {
  const scope = roomScope(room)
  const parents = []
  const seen = new Set<string>()
  let branch = room.active_branch_id
  let before: bigint | undefined
  while (branch) {
    if (seen.has(branch)) throw new Error('数据库中的 Bot 分支关系存在循环')
    seen.add(branch)
    const [changed] = await db
      .select({ source: botMessage.edited_from_message_id })
      .from(botMessage)
      .where(and(scope, eq(botMessage.id, branch)))
    const [source] = changed?.source
      ? await db
          .select({ branch: botMessage.branch_id, sequence: botMessage.sequence })
          .from(botMessage)
          .where(and(scope, eq(botMessage.id, changed.source)))
      : []
    if (!source) throw new Error('会话分支的原始消息不存在')
    parents.push(
      and(eq(botMessage.branch_id, branch), before === undefined ? undefined : lt(botMessage.sequence, before)),
    )
    before = source.sequence
    branch = source.branch
  }
  return and(
    scope,
    or(
      ...parents,
      and(isNull(botMessage.branch_id), before === undefined ? undefined : lt(botMessage.sequence, before)),
    ),
  )
}

/**
 * 计算当前消息页中编辑分支的位置。
 * @param db 可读房间记录的数据库。
 * @param room 当前房间。
 * @param messages 已按展示顺序筛选的消息。
 * @returns 消息与同一编辑点的分支数量、位置映射，位置从一开始。
 */
export async function readBotBranchSiblings(db: ReadDb, room: Room, messages: Message[]) {
  const roots = [
    ...new Set(
      messages
        .filter(({ speaker_kind }) => speaker_kind === 'user')
        .map(({ id, edited_from_message_id }) => edited_from_message_id ?? id),
    ),
  ]
  if (!roots.length) return new Map<string, { index: number; total: number }>()
  const siblings = await db
    .select({ id: botMessage.id, original: botMessage.edited_from_message_id })
    .from(botMessage)
    .where(and(roomScope(room), or(inArray(botMessage.id, roots), inArray(botMessage.edited_from_message_id, roots))))
    .orderBy(asc(botMessage.sequence))
  const byRoot = new Map<string, string[]>()
  for (const item of siblings) {
    const key = item.original ?? item.id
    const ids = byRoot.get(key) ?? []
    ids.push(item.id)
    byRoot.set(key, ids)
  }
  return new Map(
    [...byRoot.values()]
      .filter((ids) => ids.length > 1)
      .flatMap((ids) => ids.map((id, offset) => [id, { index: offset + 1, total: ids.length }])),
  )
}

/**
 * 读取指定编辑点的全部版本，按房间日志顺序排列。
 * @param db 已锁定会话的事务。
 * @param room 当前私聊房间。
 * @param messageId 当前选中的消息。
 * @returns 版本列表；消息不存在时返回空。
 */
export async function botBranchVersions(db: ReadDb, room: Room, messageId: string) {
  const scope = roomScope(room)
  const [message] = await db
    .select({ original: botMessage.edited_from_message_id })
    .from(botMessage)
    .where(and(scope, eq(botMessage.id, messageId), eq(botMessage.speaker_kind, 'user')))
  if (!message) return []
  const root = message.original ?? messageId
  return db
    .select({ id: botMessage.id, branch: botMessage.branch_id })
    .from(botMessage)
    .where(and(scope, or(eq(botMessage.id, root), eq(botMessage.edited_from_message_id, root))))
    .orderBy(asc(botMessage.sequence))
}

/**
 * 更新房间及已有 Bot 会话的活跃分支。保留原条目，下一条写入从选中的叶子继续。
 * @param tx 已锁定且没有执行中运行的会话事务。
 * @param room 当前会话。
 * @param branchId 新分支标识；空值恢复未编辑的主分支。
 * @param before 可选的编辑点序号，只恢复编辑点之前的历史。
 * @returns 房间和会话叶子更新完成后结束。
 */
export async function setBotBranch(tx: BotRunTransaction, room: Room, branchId: string | null, before?: bigint) {
  await tx
    .update(botConversation)
    .set({ active_branch_id: branchId, updated_at: sql`clock_timestamp()` })
    .where(and(eq(botConversation.id, room.id), eq(botConversation.team_id, room.team_id)))
  const scope = await activeBotBranchScope(tx, { ...room, active_branch_id: branchId })
  const sessions = await tx
    .select({ id: botSession.id })
    .from(botSession)
    .where(
      and(
        eq(botSession.team_id, room.team_id),
        eq(botSession.conversation_id, room.id),
        eq(botSession.status, 'active'),
      ),
    )
  for (const { id } of sessions) {
    const [tip] = await tx
      .select({ leaf: botSessionEntry.entry_id, cursor: botMessage.sequence })
      .from(botSessionEntry)
      .innerJoin(botMessage, eq(botSessionEntry.source_message_id, botMessage.id))
      .where(
        and(
          eq(botSessionEntry.team_id, room.team_id),
          eq(botSessionEntry.session_id, id),
          scope,
          before === undefined ? undefined : lt(botMessage.sequence, before),
        ),
      )
      .orderBy(desc(botSessionEntry.sequence))
      .limit(1)
    await tx
      .update(botSession)
      .set({
        leaf_entry_id: tip?.leaf ?? null,
        synced_message_sequence: tip?.cursor ?? 0n,
        updated_at: sql`clock_timestamp()`,
      })
      .where(eq(botSession.id, id))
  }
}
