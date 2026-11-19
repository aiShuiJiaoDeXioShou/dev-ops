import {
  botSessionFormatVersion,
  SessionUnavailableError,
  type JsonValue,
  type SessionStore,
} from '@dev-ops/devops-bot'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '../../../platform/database/client.ts'
import { lockBotRunLease, type BotRunLease, type ConversationBotRunRecord } from '../bots.run-queue.repository.ts'
import { acknowledgeBotRunInputs } from './run-input-queue.ts'
import { botSession, botSessionEntry } from '../bots.session.tables.ts'

/**
 * 校验 JSONB 值能作为不依赖 Pi 类型的会话条目保存。
 * @param value PostgreSQL 返回的未知值。
 * @returns 对象及子节点都是 JSON 数据时为 true。
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return typeof value === 'object' && Object.values(value).every(isJsonValue)
}

/**
 * 确认运行是否已经持久化当前输入，可以从会话树继续执行。
 * @param db 执行进程数据库。
 * @param run 已重新领取的会话运行。
 * @returns 本次运行的用户输入存在时为 true。
 */
export async function hasSavedBotInput(db: Database, run: ConversationBotRunRecord): Promise<boolean> {
  const [row] = await db
    .select({ id: botSessionEntry.id })
    .from(botSessionEntry)
    .innerJoin(botSession, eq(botSession.id, botSessionEntry.session_id))
    .where(
      and(
        eq(botSession.team_id, run.team_id),
        eq(botSession.conversation_id, run.conversation_id),
        eq(botSession.bot_id, run.bot_id),
        eq(botSessionEntry.run_id, run.id),
        eq(botSessionEntry.team_id, run.team_id),
        eq(botSessionEntry.entry_type, 'message'),
        sql`${botSessionEntry.content}->'message'->>'role' = 'user'`,
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * 读写本次会话对应的 PostgreSQL 条目树。租约校验、条目追加、叶子和房间游标同事务提交。
 * @param db 运行数据库。
 * @param run 当前已领取的会话运行。
 * @param lease 当前运行代次。
 * @param roomCursor 模型读到的房间序列；主动压缩不传游标。
 * @returns 运行库所用持久化端口。
 */
export function createPgSessionStore(
  db: Database,
  run: ConversationBotRunRecord,
  lease: BotRunLease,
  roomCursor?: bigint,
): SessionStore {
  const scope = and(
    eq(botSession.team_id, run.team_id),
    eq(botSession.conversation_id, run.conversation_id),
    eq(botSession.bot_id, run.bot_id),
  )

  async function markCorrupted() {
    await db.transaction(async (tx) => {
      if (!(await lockBotRunLease(tx, lease))) throw new Error('Bot 运行租约已失效')
      await tx.update(botSession).set({ status: 'corrupted', updated_at: new Date() }).where(scope)
    })
  }

  return {
    async load() {
      const [session] = await db
        .select({
          id: botSession.id,
          status: botSession.status,
          version: botSession.format_version,
          leaf: botSession.leaf_entry_id,
        })
        .from(botSession)
        .where(scope)
      if (!session) return { entries: [], leafEntryId: null }
      if (session.status !== 'active') throw new SessionUnavailableError('会话需要重新播种')
      if (session.version !== botSessionFormatVersion) {
        await markCorrupted()
        throw new SessionUnavailableError('会话格式版本不可用')
      }
      const rows = await db
        .select({
          entryId: botSessionEntry.entry_id,
          parentEntryId: botSessionEntry.parent_entry_id,
          type: botSessionEntry.entry_type,
          content: botSessionEntry.content,
          sourceMessageId: botSessionEntry.source_message_id,
        })
        .from(botSessionEntry)
        .where(and(eq(botSessionEntry.session_id, session.id), eq(botSessionEntry.team_id, run.team_id)))
        .orderBy(asc(botSessionEntry.sequence))
      const entries = rows.flatMap(({ content, sourceMessageId, ...entry }) =>
        isJsonValue(content) ? [{ ...entry, content, ...(sourceMessageId ? { sourceMessageId } : {}) }] : [],
      )
      if (
        entries.length !== rows.length ||
        (session.leaf !== null && !entries.some(({ entryId }) => entryId === session.leaf))
      ) {
        await markCorrupted()
        throw new SessionUnavailableError('会话记录包含无效内容或叶子')
      }
      return { entries, leafEntryId: session.leaf }
    },
    markCorrupted,
    async append(entries, leafEntryId) {
      if (!entries.length) return
      await db.transaction(async (tx) => {
        const claimed = await lockBotRunLease(tx, lease)
        if (!claimed) throw new Error('Bot 运行租约已失效')
        await tx
          .insert(botSession)
          .values({
            team_id: run.team_id,
            conversation_id: run.conversation_id,
            bot_id: run.bot_id,
            format_version: botSessionFormatVersion,
          })
          .onConflictDoNothing({ target: [botSession.conversation_id, botSession.bot_id] })
        const [session] = await tx
          .select({ id: botSession.id, status: botSession.status })
          .from(botSession)
          .where(scope)
          .for('update')
        if (!session || session.status !== 'active') throw new Error('Bot 会话已不可用')
        const [latest] = await tx
          .select({ sequence: sql<string>`max(${botSessionEntry.sequence})` })
          .from(botSessionEntry)
          .where(eq(botSessionEntry.session_id, session.id))
        let sequence = BigInt(latest?.sequence ?? '0')
        for (let offset = 0; offset < entries.length; offset += 100) {
          await tx.insert(botSessionEntry).values(
            entries.slice(offset, offset + 100).map((entry) => ({
              team_id: run.team_id,
              session_id: session.id,
              entry_id: entry.entryId,
              parent_entry_id: entry.parentEntryId,
              entry_type: entry.type,
              sequence: ++sequence,
              content: entry.content,
              source_message_id: entry.sourceMessageId,
              run_id: run.id,
            })),
          )
        }
        await acknowledgeBotRunInputs(
          tx,
          run,
          entries.flatMap(({ sourceMessageId }) => (sourceMessageId ? [sourceMessageId] : [])),
        )
        const savedInput =
          roomCursor !== undefined &&
          entries.some(
            ({ content }) =>
              typeof content === 'object' &&
              content !== null &&
              !Array.isArray(content) &&
              content.type === 'message' &&
              typeof content.message === 'object' &&
              content.message !== null &&
              !Array.isArray(content.message) &&
              content.message?.role === 'user',
          )
        await tx
          .update(botSession)
          .set({
            leaf_entry_id: leafEntryId,
            ...(savedInput
              ? {
                  synced_message_sequence: sql`greatest(${botSession.synced_message_sequence}, ${roomCursor})`,
                  seeded_at: sql`coalesce(${botSession.seeded_at}, clock_timestamp())`,
                }
              : {}),
            updated_at: new Date(),
          })
          .where(eq(botSession.id, session.id))
      })
    },
  }
}
