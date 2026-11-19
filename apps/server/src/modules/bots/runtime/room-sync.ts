import { and, desc, eq, gt, inArray, lt, lte, ne, notExists, or, sql } from 'drizzle-orm'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { botMessageBodySchema } from '../../collaboration/bot-message-body.ts'
import { activeBotBranchScope } from '../../collaboration/bot-branches.repository.ts'
import { botConversation, botMessage } from '../../collaboration/bot-conversations.tables.ts'
import { authUser } from '../../identity/identity.tables.ts'
import type { ConversationBotRunRecord } from '../bots.run-queue.repository.ts'
import { botRunInput, botSession } from '../bots.session.tables.ts'
import { bot, botRun } from '../bots.tables.ts'

const SEED_LIMIT = 24
const messageFields = {
  id: botMessage.id,
  sequence: botMessage.sequence,
  kind: botMessage.speaker_kind,
  speakerId: botMessage.speaker_id,
  body: botMessage.body,
}

/**
 * 读取运行开始时的房间片段与触发消息。首次播种和增量同步使用同一房间序列。
 * @param db 运行数据库。
 * @param run 已领取的会话运行。
 * @param syncLimit 增量同步最多读取的非本 Bot 消息数。
 * @returns 当前消息、房间上下文及待持久化的游标。
 */
export async function readBotRoomSync(db: Database, run: ConversationBotRunRecord, syncLimit: number) {
  const [conversation] = await db
    .select({
      id: botConversation.id,
      team_id: botConversation.team_id,
      active_branch_id: botConversation.active_branch_id,
    })
    .from(botConversation)
    .where(and(eq(botConversation.team_id, run.team_id), eq(botConversation.id, run.conversation_id)))
  if (!conversation) throw new Error('运行所属会话不存在')
  const scope = await activeBotBranchScope(db, conversation)
  const [[session], [input]] = await Promise.all([
    db
      .select({ cursor: botSession.synced_message_sequence, seededAt: botSession.seeded_at })
      .from(botSession)
      .where(
        and(
          eq(botSession.team_id, run.team_id),
          eq(botSession.conversation_id, run.conversation_id),
          eq(botSession.bot_id, run.bot_id),
        ),
      ),
    run.trigger_message_id
      ? db
          .select(messageFields)
          .from(botMessage)
          .where(and(scope, eq(botMessage.id, run.trigger_message_id)))
      : Promise.resolve([]),
  ])
  const after = session?.cursor ?? 0n
  const before = input
    ? lt(botMessage.sequence, input.sequence)
    : lte(botMessage.created_at, run.started_at ?? run.created_at)
  const limit = session?.seededAt ? syncLimit : SEED_LIMIT
  const alreadyDelivered = db
    .select({ id: botRunInput.id })
    .from(botRunInput)
    .innerJoin(
      botRun,
      and(eq(botRun.id, botRunInput.run_id), eq(botRun.bot_id, run.bot_id), eq(botRun.team_id, run.team_id)),
    )
    .where(
      and(
        eq(botRunInput.team_id, run.team_id),
        eq(botRunInput.message_id, botMessage.id),
        eq(botRunInput.status, 'delivered'),
      ),
    )
  const rows = await db
    .select({ ...messageFields, total: sql<string>`count(*) over ()` })
    .from(botMessage)
    .where(
      and(
        scope,
        before,
        gt(botMessage.sequence, after),
        notExists(alreadyDelivered),
        session?.seededAt ? or(ne(botMessage.speaker_kind, 'bot'), ne(botMessage.speaker_id, run.bot_id)) : undefined,
      ),
    )
    .orderBy(desc(botMessage.sequence))
    .limit(limit)
  const omitted = BigInt(rows[0]?.total ?? '0') - BigInt(rows.length)
  const included = rows
  const cursor = input?.sequence ?? included[0]?.sequence ?? after
  const relevant = input ? [...included, input] : included
  const idsOf = (kind: string) => [
    ...new Set(relevant.flatMap((row) => (row.kind === kind && row.speakerId ? [row.speakerId] : []))),
  ]
  const userIds = idsOf('user')
  const botIds = idsOf('bot')
  const [users, bots] = await Promise.all([
    userIds.length
      ? db.select({ id: authUser.id, name: authUser.name }).from(authUser).where(inArray(authUser.id, userIds))
      : [],
    botIds.length
      ? db
          .select({ id: bot.id, name: bot.name })
          .from(bot)
          .where(and(eq(bot.team_id, run.team_id), inArray(bot.id, botIds)))
      : [],
  ])
  const names = new Map([...users, ...bots].map(({ id, name }) => [id, name]))
  function textOf(row: Pick<(typeof rows)[number], keyof typeof messageFields>): string {
    if (!Check(botMessageBodySchema, row.body)) throw new Error('数据库中的会话消息格式不合法')
    const name = row.speakerId ? names.get(row.speakerId) : undefined
    const speaker = name ?? (row.kind === 'bot' ? 'Bot' : row.kind === 'user' ? '成员' : '系统')
    const text = row.body.blocks.map((item) => (item.type === 'tool_activity' ? item.summary : item.text)).join('\n')
    return `${speaker}：${text}`
  }

  const history = [
    ...(omitted > 0n ? [`（已省略 ${omitted} 条更早的房间消息）`] : []),
    ...included.reverse().map(textOf),
  ]
  return {
    cursor,
    input: input ? textOf(input) : null,
    sourceMessageId: input?.id,
    roomContext: history.length
      ? [session?.seededAt ? '上次回复以来的消息' : '最近的房间消息', ...history].join('\n')
      : undefined,
    skillReferences: input && Check(botMessageBodySchema, input.body) ? (input.body.references?.skillIds ?? []) : [],
  }
}
