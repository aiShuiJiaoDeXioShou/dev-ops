import { and, asc, count, desc, eq, exists, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { enqueueBotRun, type BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import { botWorkerOnline, requireRunnableBot, runnableBotIds } from '../bots/bots.service.ts'
import { readBotSkillCandidates } from '../bots/bots.skills.ts'
import { bot, botRun } from '../bots/bots.tables.ts'
import { redactChatContent } from '../bots/runtime/content.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import { authUser, teamMember } from '../identity/identity.tables.ts'
import {
  botConversation,
  botConversationMember,
  botEvent,
  botMessage,
  workTagLink,
} from './bot-conversations.tables.ts'
import type {
  BotConversationView,
  ConversationActiveRun,
  ConversationEvent,
  ConversationListFilters,
  ConversationMemberView,
  ConversationMessage,
  SendBotMessageInput,
} from './bot-conversations.schema.ts'
import { botMessageBodySchema } from './bot-message-body.ts'
import { readTargetWorkTags } from './work-tags.repository.ts'

const EDIT_ROLES: TeamRole[] = ['admin', 'developer']
const LIST_PAGE_SIZE = 30
const EVENT_PAGE_SIZE = 100
const MAX_SEQUENCE = 9223372036854775807n

type ReadDb = Pick<Database, 'select'>
type ConversationRow = typeof botConversation.$inferSelect

function accessError(): never {
  throw new ApiError(ERROR_CODES.BOT_CONVERSATION_NOT_FOUND, '会话不存在或不可见')
}

function viewOf(row: ConversationRow): BotConversationView {
  const kind = row.kind
  if (kind !== 'direct' && kind !== 'group') throw new Error('数据库中的 Bot 会话类型不合法')
  return {
    id: row.id,
    teamId: row.team_id,
    kind,
    name: row.name,
    leaderBotId: row.leader_bot_id,
    responsibility: row.responsibility,
    instructions: row.instructions,
    lastMessageAt: row.last_message_at.toISOString(),
  }
}

function messageView(row: typeof botMessage.$inferSelect, speakerName: string | null): ConversationMessage {
  const speakerKind = row.speaker_kind
  if (speakerKind !== 'user' && speakerKind !== 'bot' && speakerKind !== 'system')
    throw new Error('数据库中的会话发言人类型不合法')
  if (!Check(botMessageBodySchema, row.body)) throw new Error('数据库中的 Bot 消息格式不合法')
  return {
    id: row.id,
    sequence: row.sequence.toString(),
    speakerKind,
    speakerId: row.speaker_id,
    speakerName,
    body: row.body,
    runId: row.run_id,
    createdAt: row.created_at.toISOString(),
  }
}

function toEvent(row: typeof botEvent.$inferSelect): ConversationEvent {
  const kind = row.kind
  if (kind !== 'run_status' && kind !== 'output_delta' && kind !== 'message_committed' && kind !== 'tool_activity') {
    throw new Error('数据库中的会话事件类型不合法')
  }
  return {
    runId: row.run_id,
    kind,
    sequence: row.sequence.toString(),
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  }
}

function sequenceOf(value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined
  const parsed = BigInt(value)
  if (parsed > MAX_SEQUENCE) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '会话游标超出范围')
  return parsed
}

async function readMembers(db: ReadDb, conversation: ConversationRow): Promise<ConversationMemberView[]> {
  const rows = await db
    .select({
      id: botConversationMember.member_id,
      kind: botConversationMember.member_kind,
      userName: authUser.name,
      botName: bot.name,
    })
    .from(botConversationMember)
    .leftJoin(
      authUser,
      and(eq(authUser.id, botConversationMember.member_id), eq(botConversationMember.member_kind, 'user')),
    )
    .leftJoin(
      bot,
      and(
        eq(bot.id, botConversationMember.member_id),
        eq(bot.team_id, conversation.team_id),
        eq(botConversationMember.member_kind, 'bot'),
      ),
    )
    .where(
      and(
        eq(botConversationMember.team_id, conversation.team_id),
        eq(botConversationMember.conversation_id, conversation.id),
        isNull(botConversationMember.removed_at),
      ),
    )
    .orderBy(asc(botConversationMember.created_at), asc(botConversationMember.id))
    .limit(200)
  return rows.map((row) => {
    if (row.kind === 'bot') return { id: row.id, kind: row.kind, name: row.botName ?? '智能体' }
    if (row.kind === 'user') return { id: row.id, kind: row.kind, name: row.userName ?? '成员' }
    throw new Error('数据库中的会话成员类型不合法')
  })
}

/**
 * 将已获授权的会话与成员关系组装为公开详情。
 * @param db 数据库或当前事务。
 * @param row 业务用例已校验的会话。
 * @returns 当前成员与会话配置。
 */
export async function readBotConversationView(db: ReadDb, row: ConversationRow) {
  const [members, tags] = await Promise.all([
    readMembers(db, row),
    readTargetWorkTags(db, row.team_id, { targetKind: 'conversation', targetId: row.id }),
  ])
  const available = await runnableBotIds(
    db,
    row.team_id,
    members.filter(({ kind }) => kind === 'bot').map(({ id }) => id),
  )
  const skillReferences = await readBotSkillCandidates(db, row.team_id, available)
  return { ...viewOf(row), members, tags, skillReferences }
}

function mentionedBotNames(text: string, members: ConversationMemberView[]): string[] {
  return members.flatMap(({ id, name, kind }) => {
    if (kind !== 'bot') return []
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const pattern = new RegExp(`(?:^|\\s)@${safeName}(?=$|[\\s，。,.!?；;:：、！？])`, 'iu')
    return pattern.test(text) ? [id] : []
  })
}

function membershipQuery(db: ReadDb, actor: SessionUser) {
  return db
    .select({ row: botConversation, role: teamMember.role })
    .from(botConversation)
    .innerJoin(
      botConversationMember,
      and(
        eq(botConversationMember.conversation_id, botConversation.id),
        eq(botConversationMember.team_id, botConversation.team_id),
        eq(botConversationMember.member_kind, 'user'),
        eq(botConversationMember.member_id, actor.id),
        isNull(botConversationMember.removed_at),
      ),
    )
    .innerJoin(
      teamMember,
      and(
        eq(teamMember.team_id, botConversation.team_id),
        eq(teamMember.user_id, actor.id),
        eq(teamMember.status, 'active'),
      ),
    )
}

/**
 * 校验用户当前具备会话可见权限。团队或平台级角色不替代成员关系。
 * @param db 数据库或当前事务。
 * @param actor 当前认证成员。
 * @param conversationId 会话标识。
 * @param edit 是否要求写权限。
 * @returns 有效会话；失去成员资格时以不可见处理。
 */
export async function requireBotConversation(db: ReadDb, actor: SessionUser, conversationId: string, edit = false) {
  const [member] = await membershipQuery(db, actor).where(eq(botConversation.id, conversationId))
  if (!member) accessError()
  if (edit && member.role !== 'admin' && member.role !== 'developer') {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '当前角色只可阅读此会话')
  }
  return member.row
}

/**
 * 先锁会话行再读取编辑权限，用于串行分配消息序号与变更关联成员。
 * @param tx 将执行写入的事务。
 * @param actor 当前认证成员。
 * @param conversationId 会话标识。
 * @returns 已锁定且当前可写的会话。
 */
export async function lockWritableBotConversation(tx: BotRunTransaction, actor: SessionUser, conversationId: string) {
  const [locked] = await tx
    .select({ id: botConversation.id })
    .from(botConversation)
    .where(eq(botConversation.id, conversationId))
    .for('update')
  if (!locked) accessError()
  return requireBotConversation(tx, actor, conversationId, true)
}

/**
 * 组装 Bot 私聊、消息与事件端口。
 * @param db 平台数据库连接。
 * @returns 会话用例，读写均校验当前成员与角色权限。
 */
export function createBotConversationsService(db: Database) {
  return {
    /** 列出当前成员在本团队可见的会话。 */
    async list(actor: SessionUser, teamId: string, filters: ConversationListFilters) {
      const cursor = filters.cursor ? await requireBotConversation(db, actor, filters.cursor) : undefined
      if (cursor && cursor.team_id !== teamId) accessError()
      const search = filters.query?.trim().replace(/[\\%_]/gu, '\\$&')
      const rows = await membershipQuery(db, actor)
        .where(
          and(
            eq(botConversation.team_id, teamId),
            search ? sql`${botConversation.name} ilike ${`%${search}%`}` : undefined,
            cursor
              ? or(
                  lt(botConversation.last_message_at, cursor.last_message_at),
                  and(eq(botConversation.last_message_at, cursor.last_message_at), lt(botConversation.id, cursor.id)),
                )
              : undefined,
            filters.tagId
              ? exists(
                  db
                    .select({ id: workTagLink.id })
                    .from(workTagLink)
                    .where(
                      and(
                        eq(workTagLink.team_id, teamId),
                        eq(workTagLink.target_kind, 'conversation'),
                        eq(workTagLink.target_id, botConversation.id),
                        eq(workTagLink.tag_id, filters.tagId),
                      ),
                    ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(botConversation.last_message_at), desc(botConversation.id))
        .limit(LIST_PAGE_SIZE + 1)
      const items = rows.slice(0, LIST_PAGE_SIZE).map(({ row }) => viewOf(row))
      return { items, nextCursor: rows.length > LIST_PAGE_SIZE ? (items.at(-1)?.id ?? null) : null }
    },
    /** 创建或复用当前人和同团队 Bot 的唯一私聊，锁定 Bot 防止重复创建。 */
    async createDirect(actor: SessionUser, teamId: string, botId: string) {
      return db.transaction(async (tx) => {
        await requireTeamMember(tx, actor.id, teamId, EDIT_ROLES)
        const [target] = await tx
          .select({ id: bot.id, name: bot.name })
          .from(bot)
          .where(and(eq(bot.id, botId), eq(bot.team_id, teamId)))
          .for('update')
        if (!target) throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, '智能体不存在或不可见')
        const receiver = alias(botConversationMember, 'conversation_receiver')
        const [existing] = await membershipQuery(tx, actor)
          .where(
            and(
              eq(botConversation.team_id, teamId),
              eq(botConversation.kind, 'direct'),
              exists(
                tx
                  .select({ id: receiver.id })
                  .from(receiver)
                  .where(
                    and(
                      eq(receiver.conversation_id, botConversation.id),
                      eq(receiver.team_id, teamId),
                      eq(receiver.member_kind, 'bot'),
                      eq(receiver.member_id, target.id),
                      isNull(receiver.removed_at),
                    ),
                  ),
              ),
            ),
          )
          .limit(1)
        if (existing) return readBotConversationView(tx, existing.row)
        const [created] = await tx
          .insert(botConversation)
          .values({
            team_id: teamId,
            kind: 'direct',
            name: target.name.slice(0, 80),
            created_by: actor.id,
          })
          .returning()
        if (!created) throw new Error('未能创建 Bot 私聊')
        await tx.insert(botConversationMember).values([
          {
            team_id: teamId,
            conversation_id: created.id,
            member_kind: 'user',
            member_id: actor.id,
            added_by: actor.id,
          },
          { team_id: teamId, conversation_id: created.id, member_kind: 'bot', member_id: botId, added_by: actor.id },
        ])
        return readBotConversationView(tx, created)
      })
    },
    /** 读取会话与当前成员。 */
    async get(actor: SessionUser, conversationId: string) {
      const row = await requireBotConversation(db, actor, conversationId)
      return readBotConversationView(db, row)
    },
    /** 按序号读取消息并返回更早一页的游标。 */
    async messages(actor: SessionUser, conversationId: string, before?: string, limit = 50) {
      const row = await requireBotConversation(db, actor, conversationId)
      const previous = sequenceOf(before)
      const messages = await db
        .select({ message: botMessage, userName: authUser.name, botName: bot.name })
        .from(botMessage)
        .leftJoin(authUser, and(eq(authUser.id, botMessage.speaker_id), eq(botMessage.speaker_kind, 'user')))
        .leftJoin(
          bot,
          and(eq(bot.id, botMessage.speaker_id), eq(bot.team_id, row.team_id), eq(botMessage.speaker_kind, 'bot')),
        )
        .where(
          and(
            eq(botMessage.team_id, row.team_id),
            eq(botMessage.conversation_id, row.id),
            previous === undefined ? undefined : lt(botMessage.sequence, previous),
          ),
        )
        .orderBy(desc(botMessage.sequence))
        .limit(limit + 1)
      const page = messages.slice(0, limit).map((item) => messageView(item.message, item.userName ?? item.botName))
      return { nextBefore: messages.length > limit ? (page.at(-1)?.sequence ?? null) : null, items: page.reverse() }
    },
    /** 发送消息并排队；重复请求复用已保存的同一次运行。 */
    async send(actor: SessionUser, conversationId: string, input: SendBotMessageInput) {
      const text = redactChatContent(input.text.trim())
      if (!text) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '消息不能为空')
      const references = { mentionBotId: input.mentionBotId, skillIds: [...(input.skillIds ?? [])].sort() }
      return db.transaction(async (tx) => {
        const conversation = await lockWritableBotConversation(tx, actor, conversationId)
        const scope = and(eq(botMessage.team_id, conversation.team_id), eq(botMessage.conversation_id, conversationId))
        const [same] = await tx
          .select()
          .from(botMessage)
          .where(and(scope, eq(botMessage.client_request_id, input.clientRequestId)))
        if (same) {
          const message = messageView(same, actor.name)
          if (
            message.speakerId !== actor.id ||
            message.body.blocks[0]?.type !== 'text' ||
            message.body.blocks[0].text !== text ||
            message.body.references?.mentionBotId !== references.mentionBotId ||
            (message.body.references?.skillIds ?? []).join(',') !== references.skillIds.join(',') ||
            !same.run_id
          ) {
            throw new ApiError(ERROR_CODES.IDEMPOTENCY_CONFLICT, '该请求标识已用于另一条消息')
          }
          return { message, runId: same.run_id }
        }
        const members = await readMembers(tx, conversation)
        const mentioned = new Set(input.mentionBotId ? [input.mentionBotId] : [])
        if (conversation.kind === 'group') {
          for (const id of mentionedBotNames(text, members)) mentioned.add(id)
        }
        if (mentioned.size > 1) throw new ApiError(ERROR_CODES.BOT_MENTION_AMBIGUOUS, '每条消息只能指定一个智能体')
        const explicit = [...mentioned][0]
        const targetId =
          explicit ??
          (conversation.kind === 'group' ? conversation.leader_bot_id : members.find(({ kind }) => kind === 'bot')?.id)
        if (!targetId) throw new ApiError(ERROR_CODES.BOT_NO_RECEIVER, '没有可用的智能体承接这条消息')
        if (!members.some((member) => member.kind === 'bot' && member.id === targetId)) {
          throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, '引用的智能体不是当前会话成员')
        }
        try {
          await requireRunnableBot(tx, conversation.team_id, targetId, { allowOffline: !input.skillIds?.length })
        } catch (error) {
          if (
            !explicit &&
            conversation.kind === 'group' &&
            error instanceof ApiError &&
            error.code === ERROR_CODES.BOT_UNAVAILABLE
          ) {
            throw new ApiError(ERROR_CODES.BOT_NO_RECEIVER, '当前 Leader 无法承接，请 @ 一个可用的智能体')
          }
          throw error
        }
        if (input.skillIds?.length) {
          const skills = await readBotSkillCandidates(tx, conversation.team_id, [targetId])
          const ids = new Set(skills.map(({ id }) => id))
          if (!input.skillIds.every((id) => ids.has(id))) {
            throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '消息引用的技能未配置、已停用或版本未知')
          }
        }
        const [latest] = await tx
          .select({ sequence: botMessage.sequence })
          .from(botMessage)
          .where(scope)
          .orderBy(desc(botMessage.sequence))
          .limit(1)
        const [message] = await tx
          .insert(botMessage)
          .values({
            team_id: conversation.team_id,
            conversation_id: conversationId,
            sequence: (latest?.sequence ?? 0n) + 1n,
            speaker_kind: 'user',
            speaker_id: actor.id,
            client_request_id: input.clientRequestId,
            body: { blocks: [{ type: 'text', text }], references },
          })
          .returning()
        if (!message) throw new Error('未能保存 Bot 会话消息')
        const run = await enqueueBotRun(tx, {
          team_id: conversation.team_id,
          bot_id: targetId,
          conversation_id: conversationId,
          trigger_user_id: actor.id,
          trigger_message_id: message.id,
          input_version: 0,
        })
        await tx
          .update(botMessage)
          .set({ run_id: run.id, updated_at: sql`clock_timestamp()` })
          .where(and(scope, eq(botMessage.id, message.id)))
        await tx
          .update(botConversation)
          .set({
            last_message_at: message.created_at,
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(botConversation.id, conversation.id), eq(botConversation.team_id, conversation.team_id)))
        return { message: messageView({ ...message, run_id: run.id }, actor.name), runId: run.id }
      })
    },
    /** 查询增量事件和当前在途运行；过旧游标提示重新同步。 */
    async events(actor: SessionUser, conversationId: string, after?: string) {
      const conversation = await requireBotConversation(db, actor, conversationId)
      const cursor = sequenceOf(after)
      const eventScope = and(eq(botEvent.team_id, conversation.team_id), eq(botEvent.conversation_id, conversationId))
      const [oldest] = await db
        .select({ sequence: botEvent.sequence })
        .from(botEvent)
        .where(eventScope)
        .orderBy(asc(botEvent.sequence))
        .limit(1)
      const resetRequired = cursor !== undefined && oldest !== undefined && cursor > 0 && oldest.sequence > cursor + 1n
      const rows = await db
        .select()
        .from(botEvent)
        .where(and(eventScope, cursor !== undefined && !resetRequired ? gt(botEvent.sequence, cursor) : undefined))
        .orderBy(asc(botEvent.sequence))
        .limit(EVENT_PAGE_SIZE)
      const queued = alias(botRun, 'queued_run')
      const previousQueued = db
        .select({ amount: count() })
        .from(queued)
        .where(
          and(
            eq(queued.team_id, botRun.team_id),
            eq(queued.status, 'queued'),
            sql`(${queued.created_at}, ${queued.id}) <= (${botRun.created_at}, ${botRun.id})`,
          ),
        )
      const active = await db
        .select({
          id: botRun.id,
          botId: botRun.bot_id,
          status: botRun.status,
          workerOnline: botWorkerOnline(),
          teamQueuePosition: sql<
            number | null
          >`case when ${botRun.status} = 'queued' then (${previousQueued}) end`.mapWith(Number),
        })
        .from(botRun)
        .where(
          and(
            eq(botRun.team_id, conversation.team_id),
            eq(botRun.conversation_id, conversationId),
            inArray(botRun.status, ['queued', 'running']),
          ),
        )
        .orderBy(asc(botRun.created_at), asc(botRun.id))
        .limit(200)
      const activeRuns = active.flatMap<ConversationActiveRun>(
        ({ id, botId, status, teamQueuePosition, workerOnline }) => {
          if (status === 'running') return [{ id, botId, status }]
          if (status !== 'queued' || teamQueuePosition === null) return []
          return [{ id, botId, status, teamQueuePosition, ...(workerOnline ? {} : { queueReason: 'worker_offline' }) }]
        },
      )
      return {
        items: rows.map(toEvent),
        cursor: (rows.at(-1)?.sequence ?? cursor ?? 0n).toString(),
        resetRequired,
        activeRuns,
      }
    },
  }
}

export type BotConversationsService = ReturnType<typeof createBotConversationsService>
