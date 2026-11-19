import { botSessionFormatVersion, forkSessionEntries } from '@dev-ops/devops-bot'
import { and, asc, eq } from 'drizzle-orm'
import type { BotRunTransaction } from '../bots.run-queue.repository.ts'
import { botSession, botSessionEntry } from '../bots.session.tables.ts'
import { isJsonValue } from './session-store.ts'

/**
 * 复制每个有效 Bot 在指定房间消息前缀内已持久化的会话路径。
 * @param tx 创建分叉会话的事务。
 * @param scope 原会话、新会话和团队标识。
 * @param messages 房间消息原标识与新记录的对应关系。
 * @returns 新会话的所有树完成写入后结束；损坏的原树不复制。
 */
export async function cloneBotSessionPrefixes(
  tx: BotRunTransaction,
  scope: { teamId: string; sourceId: string; targetId: string },
  messages: ReadonlyMap<string, { id: string; sequence: bigint }>,
) {
  const sessions = await tx
    .select({ id: botSession.id, botId: botSession.bot_id })
    .from(botSession)
    .where(
      and(
        eq(botSession.team_id, scope.teamId),
        eq(botSession.conversation_id, scope.sourceId),
        eq(botSession.status, 'active'),
        eq(botSession.format_version, botSessionFormatVersion),
      ),
    )
  for (const source of sessions) {
    const rows = await tx
      .select({
        entryId: botSessionEntry.entry_id,
        parentEntryId: botSessionEntry.parent_entry_id,
        type: botSessionEntry.entry_type,
        content: botSessionEntry.content,
        sourceMessageId: botSessionEntry.source_message_id,
      })
      .from(botSessionEntry)
      .where(and(eq(botSessionEntry.team_id, scope.teamId), eq(botSessionEntry.session_id, source.id)))
      .orderBy(asc(botSessionEntry.sequence))
    const endpoint = rows.findLast(({ sourceMessageId }) => sourceMessageId && messages.has(sourceMessageId))
    const originalMessage = endpoint?.sourceMessageId ? messages.get(endpoint.sourceMessageId) : undefined
    if (!endpoint || !originalMessage) continue
    const normalized = rows.map(({ sourceMessageId, content, ...row }) => {
      if (!isJsonValue(content)) throw new Error('数据库中的分叉原始条目不是合法 JSON')
      return { ...row, content, ...(sourceMessageId ? { sourceMessageId } : {}) }
    })
    const entries = forkSessionEntries(normalized, endpoint.entryId)
    const leaf = entries.at(-1)
    if (!leaf) continue
    const [created] = await tx
      .insert(botSession)
      .values({
        team_id: scope.teamId,
        conversation_id: scope.targetId,
        bot_id: source.botId,
        format_version: botSessionFormatVersion,
        leaf_entry_id: leaf.entryId,
        synced_message_sequence: originalMessage.sequence,
        seeded_at: new Date(),
      })
      .returning({ id: botSession.id })
    if (!created) throw new Error('未能创建分叉会话树')
    for (let offset = 0; offset < entries.length; offset += 100) {
      await tx.insert(botSessionEntry).values(
        entries.slice(offset, offset + 100).map((entry, index) => ({
          team_id: scope.teamId,
          session_id: created.id,
          entry_id: entry.entryId,
          parent_entry_id: entry.parentEntryId,
          entry_type: entry.type,
          sequence: BigInt(offset + index + 1),
          content: entry.content,
          source_message_id: entry.sourceMessageId ? messages.get(entry.sourceMessageId)?.id : undefined,
        })),
      )
    }
  }
}
