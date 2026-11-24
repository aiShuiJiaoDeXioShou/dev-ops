import { and, asc, eq, sql } from 'drizzle-orm'
import type { Static } from 'typebox'
import type { queuedInputView } from './bot-conversations.schema.ts'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { botRunInput, botSession, botSessionEntry } from '../bots/bots.session.tables.ts'
import { attachment } from '../attachments/attachments.tables.ts'
import { botRun } from '../bots/bots.tables.ts'
import { botMessage } from './bot-conversations.tables.ts'
import { botMessageBodySchema } from './bot-message-body.ts'
import { requireBotConversation, lockWritableBotConversation } from './bot-conversations.access.ts'

function inputView(row: { messageId: string; mode: string; body: unknown }): Static<typeof queuedInputView> {
  if (!Check(botMessageBodySchema, row.body) || (row.mode !== 'steer' && row.mode !== 'follow_up'))
    throw new Error('数据库待投递消息不合法')
  return {
    messageId: row.messageId,
    mode: row.mode,
    text: row.body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'),
    attachmentIds: row.body.attachments?.map(({ id }) => id) ?? [],
    attachments: row.body.attachments ?? [],
    skillIds: row.body.references?.skillIds ?? [],
    mentionBotIds: row.body.references?.mentionBotIds ?? [],
    mentionAll: row.body.references?.mentionAll ?? false,
  }
}

/**
 * 读取本人仍未被运行领取的消息，避免泄露其他成员草稿。
 * @param db 数据库连接。
 * @param actor 当前认证用户。
 * @param conversationId 需要读取的会话。
 * @returns 最多一百条按发送顺序排列的待投递消息。
 */
export async function readQueuedInputs(db: Database, actor: SessionUser, conversationId: string) {
  const room = await requireBotConversation(db, actor, conversationId)
  const rows = await db
    .select({ messageId: botMessage.id, mode: botRunInput.delivery_mode, body: botMessage.body })
    .from(botRunInput)
    .innerJoin(botMessage, eq(botMessage.id, botRunInput.message_id))
    .where(
      and(
        eq(botMessage.conversation_id, room.id),
        eq(botMessage.team_id, room.team_id),
        eq(botMessage.speaker_id, actor.id),
        eq(botRunInput.status, 'pending'),
      ),
    )
    .orderBy(asc(botMessage.sequence))
    .limit(100)
  return { items: rows.map(inputView) }
}

/**
 * 与运行领取共用行锁撤回消息；已领取的消息不允许再次投递。
 * @param db 数据库连接。
 * @param actor 当前认证操作者。
 * @param conversationId 消息所属会话。
 * @param messageId 需要撤回的本人消息。
 * @returns 被撤回的草稿；无权限或已消费时抛出业务异常。
 */
export async function withdrawQueuedInput(db: Database, actor: SessionUser, conversationId: string, messageId: string) {
  return db.transaction(async (tx) => {
    const room = await lockWritableBotConversation(tx, actor, conversationId)
    const [row] = await tx
      .select({
        messageId: botMessage.id,
        mode: botRunInput.delivery_mode,
        body: botMessage.body,
        runId: botRunInput.run_id,
      })
      .from(botRunInput)
      .innerJoin(botMessage, eq(botMessage.id, botRunInput.message_id))
      .where(
        and(
          eq(botMessage.id, messageId),
          eq(botMessage.conversation_id, room.id),
          eq(botMessage.team_id, room.team_id),
          eq(botMessage.speaker_id, actor.id),
        ),
      )
      .limit(1)
    if (!row) throw new ApiError(ERROR_CODES.FORBIDDEN, '消息不可撤回')
    await tx
      .select({ id: botRun.id })
      .from(botRun)
      .where(and(eq(botRun.id, row.runId), eq(botRun.team_id, room.team_id)))
      .for('update')
    const changed = await tx
      .update(botRunInput)
      .set({ status: 'withdrawn', updated_at: sql`clock_timestamp()` })
      .where(
        and(
          eq(botRunInput.message_id, messageId),
          eq(botRunInput.run_id, row.runId),
          eq(botRunInput.status, 'pending'),
        ),
      )
      .returning({ id: botRunInput.id })
    if (!changed.length) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '消息已被运行领取，无法撤回')
    await tx
      .update(attachment)
      .set({ status: 'temp', target_type: null, target_id: null, bound_at: null, updated_at: sql`clock_timestamp()` })
      .where(
        and(
          eq(attachment.target_id, messageId),
          eq(attachment.target_type, 'bot_message'),
          eq(attachment.conversation_id, room.id),
          eq(attachment.uploaded_by_user_id, actor.id),
          eq(attachment.status, 'bound'),
        ),
      )
    return inputView(row)
  })
}

/**
 * 聚合本会话全部运行的真实账单，不受消息分页或分支影响。
 * @param db 数据库连接。
 * @param actor 当前认证用户。
 * @param conversationId 需要读取的会话。
 * @returns 累计令牌和已知费用；未知费用保持空值，不伪造为零。
 */
export async function readConversationUsage(db: Database, actor: SessionUser, conversationId: string) {
  const room = await requireBotConversation(db, actor, conversationId)
  const [usage] = await db
    .select({
      inputTokens: sql<number>`coalesce(sum((${botRun.usage}->>'inputTokens')::bigint),0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum((${botRun.usage}->>'outputTokens')::bigint),0)`.mapWith(Number),
      costUsd: sql<
        number | null
      >`case when count(*) filter (where ${botRun.usage} is null or ${botRun.usage}->>'costKnown' = 'false') > 0 then null else coalesce(sum((${botRun.usage}->>'costUsd')::numeric),0) end`.mapWith(
        (value) => (value === null ? null : Number(value)),
      ),
    })
    .from(botRun)
    .where(and(eq(botRun.conversation_id, room.id), eq(botRun.team_id, room.team_id)))
  const contexts = await db
    .select({
      botId: botSession.bot_id,
      tokens: sql<
        number | null
      >`case when ${botSessionEntry.content}->'message'->>'role' = 'assistant' then coalesce((${botSessionEntry.content}->'message'->'usage'->>'input')::bigint,0) + coalesce((${botSessionEntry.content}->'message'->'usage'->>'output')::bigint,0) + coalesce((${botSessionEntry.content}->'message'->'usage'->>'cacheRead')::bigint,0) + coalesce((${botSessionEntry.content}->'message'->'usage'->>'cacheWrite')::bigint,0) else null end`.mapWith(
        (value) => (value === null ? null : Number(value)),
      ),
    })
    .from(botSession)
    .leftJoin(
      botSessionEntry,
      and(eq(botSessionEntry.session_id, botSession.id), eq(botSessionEntry.entry_id, botSession.leaf_entry_id)),
    )
    .where(
      and(
        eq(botSession.conversation_id, room.id),
        eq(botSession.team_id, room.team_id),
        eq(botSession.status, 'active'),
      ),
    )
    .limit(100)
  return { ...(usage ?? { inputTokens: 0, outputTokens: 0, costUsd: null }), contexts }
}
