import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { botConversation, botConversationMember, botMessage } from '../../collaboration/bot-conversations.tables.ts'
import { botMessageBodySchema } from '../../collaboration/bot-message-body.ts'
import { botMemoryCursor } from '../bots.platform.tables.ts'
import type { BotRunRecord } from '../bots.run-queue.repository.ts'
import { botSession, botSessionEntry } from '../bots.session.tables.ts'
import { redactChatContent } from './content.ts'

const PER_SOURCE_LIMIT = 50

/**
 * 读取游标之后有限的房间消息及摘要，按发生顺序准备整理依据。
 * @param db Worker 数据库。
 * @param run 记忆整理运行记录。
 * @returns 可引用的脱敏依据和可以安全推进的时间范围。
 */
export async function readBotMemoryJobSource(db: Database, run: BotRunRecord) {
  const [cursor] = await db
    .select({ through: botMemoryCursor.processed_until })
    .from(botMemoryCursor)
    .where(and(eq(botMemoryCursor.team_id, run.team_id), eq(botMemoryCursor.bot_id, run.bot_id)))
  const since = cursor?.through ?? new Date(0)
  const before = run.started_at ?? new Date()
  const roomMembership = and(
    eq(botConversationMember.team_id, run.team_id),
    eq(botConversationMember.conversation_id, botConversation.id),
    eq(botConversationMember.member_kind, 'bot'),
    eq(botConversationMember.member_id, run.bot_id),
    isNull(botConversationMember.removed_at),
  )
  const [messages, summaries] = await Promise.all([
    db
      .select({
        id: botMessage.id,
        room: botConversation.id,
        kind: botConversation.kind,
        userId: sql<string | null>`case when ${botMessage.speaker_kind} = 'user' then ${botMessage.speaker_id} end`,
        time: botMessage.created_at,
        body: botMessage.body,
      })
      .from(botMessage)
      .innerJoin(
        botConversation,
        and(eq(botConversation.team_id, run.team_id), eq(botConversation.id, botMessage.conversation_id)),
      )
      .innerJoin(botConversationMember, roomMembership)
      .where(
        and(
          eq(botMessage.team_id, run.team_id),
          gt(botMessage.created_at, since),
          lte(botMessage.created_at, before),
          or(eq(botMessage.speaker_kind, 'user'), eq(botMessage.speaker_id, run.bot_id)),
        ),
      )
      .orderBy(asc(botMessage.created_at), asc(botMessage.id))
      .limit(PER_SOURCE_LIMIT + 1),
    db
      .select({
        id: botSessionEntry.id,
        room: botConversation.id,
        kind: botConversation.kind,
        time: botSessionEntry.created_at,
        text: sql<unknown>`${botSessionEntry.content}->>'summary'`,
      })
      .from(botSessionEntry)
      .innerJoin(
        botSession,
        and(
          eq(botSession.id, botSessionEntry.session_id),
          eq(botSession.team_id, run.team_id),
          eq(botSession.bot_id, run.bot_id),
          eq(botSession.status, 'active'),
        ),
      )
      .innerJoin(
        botConversation,
        and(eq(botConversation.id, botSession.conversation_id), eq(botConversation.team_id, run.team_id)),
      )
      .innerJoin(botConversationMember, roomMembership)
      .where(
        and(
          eq(botSessionEntry.team_id, run.team_id),
          eq(botSessionEntry.entry_type, 'compaction'),
          gt(botSessionEntry.created_at, since),
          lte(botSessionEntry.created_at, before),
        ),
      )
      .orderBy(asc(botSessionEntry.created_at), asc(botSessionEntry.id))
      .limit(PER_SOURCE_LIMIT + 1),
  ])
  const boundary = Math.min(
    messages.at(PER_SOURCE_LIMIT)?.time.getTime() ?? Infinity,
    summaries.at(PER_SOURCE_LIMIT)?.time.getTime() ?? Infinity,
  )
  const through = new Date(Number.isFinite(boundary) ? boundary - 1 : before.getTime())
  const rows = [
    ...messages.flatMap(({ body, ...row }) => {
      if (!Check(botMessageBodySchema, body)) throw new Error('数据库中的整理来源消息不合法')
      const text = body.blocks.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
      return text ? [{ ...row, text }] : []
    }),
    ...summaries.flatMap(({ text, ...row }) =>
      typeof text === 'string' && text ? [{ ...row, userId: null, text }] : [],
    ),
  ]
    .filter(({ time }) => time <= through)
    .map((row) => ({ ...row, text: redactChatContent(row.text).slice(0, 800) }))
  return { rows, since, through: through > since ? through : since }
}
