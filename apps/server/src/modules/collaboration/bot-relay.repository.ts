import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import type { BotRunRecord, BotRunTransaction, enqueueBotRun } from '../bots/bots.run-enqueue.ts'
import { bot, botRun } from '../bots/bots.tables.ts'
import { appendBotEvents } from './bot-events.repository.ts'
import { botConversationMember, botMessage } from './bot-conversations.tables.ts'
import { botMessageBodySchema } from './bot-message-body.ts'
import { botRoomRelay } from './bot-relay.tables.ts'

export type BotRelayRecord = typeof botRoomRelay.$inferSelect
export type BotRelayLimits = { hop: number; reply: number }
export const defaultBotRelayLimits: BotRelayLimits = { hop: 4, reply: 10 }

const ids = Type.Array(Type.String())
const status = Type.Union([
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('finished'),
  Type.Literal('stopped'),
])
const reasons = Type.Union([
  Type.Literal('completed'),
  Type.Literal('limit'),
  Type.Literal('stopped_by_member'),
  Type.Literal('budget_exhausted'),
  Type.Literal('ended_by_member'),
])
type Scope = { teamId: string; conversationId: string }

function scopeOf(scope: Scope) {
  return and(eq(botRoomRelay.team_id, scope.teamId), eq(botRoomRelay.conversation_id, scope.conversationId))
}

/**
 * 读取会话正在进行或暂停的接力。
 * @param db 业务事务或只读连接。
 * @param scope 经授权的团队与会话。
 * @returns 当前接力，空时返回 undefined。
 */
export async function readActiveBotRelay(
  db: Pick<Database, 'select'>,
  scope: Scope,
): Promise<BotRelayRecord | undefined> {
  const [row] = await db
    .select()
    .from(botRoomRelay)
    .where(and(scopeOf(scope), inArray(botRoomRelay.status, ['running', 'paused'])))
  return row
}

/**
 * 将接力记录转换为会话成员可见的进度。
 * @param row 经过范围校验的接力记录。
 * @param limits 会话用的跳数和回复额度。
 * @returns 当前接力的公开进度；状态或 JSON 格式不合法时抛错。
 */
export function botRelayView(row: BotRelayRecord, limits = defaultBotRelayLimits) {
  if (
    !Check(status, row.status) ||
    !Check(ids, row.pending_bot_ids) ||
    (row.end_reason !== null && !Check(reasons, row.end_reason))
  ) {
    throw new Error('数据库中的 Bot 接力状态不合法')
  }
  return {
    id: row.id,
    status: row.status,
    hopCount: row.hop_count,
    hopLimit: limits.hop,
    replyCount: row.reply_count,
    replyLimit: limits.reply,
    continueCount: row.continue_count,
    version: row.version,
    pendingBotIds: row.pending_bot_ids,
    ...(row.end_reason === null ? {} : { endReason: row.end_reason }),
  }
}

/**
 * 从成员消息创建接力，初始接收者由已经排队的首条运行承接。
 * @param tx 创建消息或领取首条运行所在事务。
 * @param input 团队、会话、成员和收件 Bot 顺序。
 * @returns 接力记录；并发创建其他接力时返回 undefined。
 */
export async function openBotRelay(
  tx: BotRunTransaction,
  input: Scope & {
    messageId: string
    actorId: string
    receivers: string[]
  },
) {
  const [row] = await tx
    .insert(botRoomRelay)
    .values({
      team_id: input.teamId,
      conversation_id: input.conversationId,
      origin_message_id: input.messageId,
      trigger_user_id: input.actorId,
      pending_bot_ids: input.receivers.slice(1),
    })
    .onConflictDoNothing()
    .returning()
  return row
}

/**
 * 从群聊的原始成员消息读取已保存的目标。
 * @param db 会话工作事务。
 * @param scope 群聊归属。
 * @param messageId 已保存的原始消息。
 * @returns 初始接收者顺序和全员标记。
 */
export async function readBotRelayReceivers(db: Pick<Database, 'select'>, scope: Scope, messageId: string) {
  const [message] = await db
    .select({ body: botMessage.body })
    .from(botMessage)
    .where(
      and(
        eq(botMessage.team_id, scope.teamId),
        eq(botMessage.conversation_id, scope.conversationId),
        eq(botMessage.id, messageId),
      ),
    )
  if (!message || !Check(botMessageBodySchema, message.body)) throw new Error('接力的原始消息不存在或不合法')
  return {
    ids: message.body.references?.relayRecipients ?? [],
    all: message.body.references?.mentionAll ?? false,
  }
}

/**
 * 结束或暂停接力并发布会话事件。
 * @param tx 同一会话处理事务。
 * @param row 已锁定的接力及其版本。
 * @param update 接力计数、待回复列表和状态。
 * @param runId 相关运行，供轨迹索引。
 * @returns 更新后的接力，版本异常时抛错。
 */
export async function updateBotRelay(
  tx: BotRunTransaction,
  row: BotRelayRecord,
  update: Partial<
    Pick<
      BotRelayRecord,
      'status' | 'end_reason' | 'hop_count' | 'reply_count' | 'pending_bot_ids' | 'trigger_user_id' | 'continue_count'
    >
  >,
  runId?: string,
) {
  const [saved] = await tx
    .update(botRoomRelay)
    .set({
      ...update,
      version: row.version + 1,
      updated_at: sql`clock_timestamp()`,
    })
    .where(and(eq(botRoomRelay.id, row.id), eq(botRoomRelay.version, row.version)))
    .returning()
  if (!saved) throw new Error('同一事务内 Bot 接力状态已改变')
  if (runId && (saved.status === 'paused' || saved.status === 'stopped' || saved.status === 'finished')) {
    await appendBotEvents(tx, { teamId: row.team_id, conversationId: row.conversation_id, runId }, [
      {
        kind: saved.status === 'paused' ? 'relay_paused' : 'relay_finished',
        payload: { relayId: row.id, status: saved.status, endReason: saved.end_reason },
      },
    ])
  }
  return saved
}

/**
 * 在接力的一次回复提交后，计算剩余额度，排入下一位或暂停。
 * @param tx 回写运行结果的事务。
 * @param row 已锁定的当前接力。
 * @param limits 跳数与回复额度。
 * @param enqueue 运行队列写入函数。
 * @param run 本轮关闭的运行，用其标识关联轨迹。
 * @param mentions 本轮点名，依原顺序。
 * @param didReply 是否实际写入 Bot 回复。
 * @returns 本轮推进后的接力。
 */
export async function advanceBotRelay(
  tx: BotRunTransaction,
  row: BotRelayRecord,
  limits: BotRelayLimits,
  enqueue: typeof enqueueBotRun,
  run?: BotRunRecord,
  mentions: readonly string[] = [],
  didReply = false,
) {
  const view = botRelayView(row, limits)
  const scope = { teamId: row.team_id, conversationId: row.conversation_id }
  const current = run?.bot_id
  const eligible = mentions.length
    ? await tx
        .select({ id: bot.id })
        .from(botConversationMember)
        .innerJoin(
          bot,
          and(eq(bot.id, botConversationMember.member_id), eq(bot.team_id, scope.teamId), eq(bot.status, 'enabled')),
        )
        .where(
          and(
            eq(botConversationMember.team_id, scope.teamId),
            eq(botConversationMember.conversation_id, scope.conversationId),
            eq(botConversationMember.member_kind, 'bot'),
            isNull(botConversationMember.removed_at),
            inArray(botConversationMember.member_id, [...mentions]),
          ),
        )
    : []
  const enabled = new Set(eligible.map(({ id }) => id))
  const pending = [...new Set([...view.pendingBotIds, ...mentions.filter((id) => id !== current && enabled.has(id))])]
  const reply_count = row.reply_count + Number(didReply)
  const [target, ...remaining] = pending
  if (!target)
    return updateBotRelay(
      tx,
      row,
      { status: 'finished', end_reason: 'completed', pending_bot_ids: [], reply_count },
      run?.id,
    )

  const seeds = await readBotRelayReceivers(tx, scope, row.origin_message_id)
  const [previous] = await tx
    .select({ id: botRun.id })
    .from(botRun)
    .where(
      and(
        eq(botRun.team_id, scope.teamId),
        eq(botRun.relay_id, row.id),
        eq(botRun.bot_id, target),
        inArray(botRun.relay_role, ['leader', 'mention', 'all']),
      ),
    )
    .limit(1)
  const relayed = !seeds.ids.includes(target) || Boolean(previous)
  const hop_count = row.hop_count + Number(relayed)
  if (reply_count >= limits.reply || hop_count > limits.hop) {
    return updateBotRelay(tx, row, { status: 'paused', pending_bot_ids: pending, reply_count }, run?.id)
  }

  // 后续 Bot 以同一成员身份执行，并同步房间直到实际领取时。
  await enqueue(tx, {
    team_id: scope.teamId,
    conversation_id: scope.conversationId,
    bot_id: target,
    trigger_user_id: row.trigger_user_id,
    trigger_message_id: row.origin_message_id,
    input_version: 0,
    relay_id: row.id,
    hop: hop_count,
    relay_role: relayed ? 'relay' : seeds.all ? 'all' : 'mention',
  })
  return updateBotRelay(tx, row, { status: 'running', pending_bot_ids: remaining, reply_count, hop_count })
}

/**
 * 找到最近一次接力运行，供成员状态操作记录轨迹。
 * @param db 获取接力状态的事务。
 * @param relay 已授权的接力记录。
 * @returns 最新关联运行，尚未开始时可能没有结果。
 */
export async function latestBotRelayRun(db: Pick<Database, 'select'>, relay: BotRelayRecord) {
  const [run] = await db
    .select({ id: botRun.id, status: botRun.status })
    .from(botRun)
    .where(and(eq(botRun.team_id, relay.team_id), eq(botRun.relay_id, relay.id)))
    .orderBy(desc(botRun.created_at), desc(botRun.id))
    .limit(1)
  return run
}

/**
 * 返回群聊当前可被点名的 Bot。
 * @param db 平台数据库。
 * @param scope 已授权的对话范围。
 * @returns 按成员加入顺序排列的可用 Bot 标识与名称。
 */
export async function relayMentionableBots(db: Pick<Database, 'select'>, scope: Scope) {
  return db
    .select({ id: bot.id, name: bot.name })
    .from(botConversationMember)
    .innerJoin(
      bot,
      and(eq(bot.id, botConversationMember.member_id), eq(bot.team_id, scope.teamId), eq(bot.status, 'enabled')),
    )
    .where(
      and(
        eq(botConversationMember.team_id, scope.teamId),
        eq(botConversationMember.conversation_id, scope.conversationId),
        eq(botConversationMember.member_kind, 'bot'),
        isNull(botConversationMember.removed_at),
      ),
    )
    .orderBy(asc(botConversationMember.created_at), asc(botConversationMember.id))
    .limit(200)
}
