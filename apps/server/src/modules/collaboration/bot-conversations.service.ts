import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, exists, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { isBotBudgetExhausted } from '../bots/bots.budget-read.ts'
import { requireBotPromptTemplate } from '../bots/bots.prompt-templates.ts'
import { readBotSessionSettings, saveBotSessionSetting } from '../bots/bots.session-settings.ts'
import { botRunInput, botSession, botSessionEntry } from '../bots/bots.session.tables.ts'
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
  botMessageFeedback,
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
  SendBotMessageResult,
} from './bot-conversations.schema.ts'
import { conversationEventKind } from './bot-conversations.schema.ts'
import {
  activeBotBranchScope,
  botBranchVersions,
  readBotBranchSiblings,
  setBotBranch,
} from './bot-branches.repository.ts'
import {
  botRelayView,
  defaultBotRelayLimits,
  latestBotRelayRun,
  openBotRelay,
  readActiveBotRelay,
  updateBotRelay,
} from './bot-relay.repository.ts'
import { forkBotConversation } from './bot-fork.service.ts'
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
    ...(row.forked_from_conversation_id && row.forked_from_message_id
      ? { forkedFrom: { conversationId: row.forked_from_conversation_id, messageId: row.forked_from_message_id } }
      : {}),
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
    branchId: row.branch_id,
    relayId: row.relay_id,
    createdAt: row.created_at.toISOString(),
  }
}

function toEvent(row: typeof botEvent.$inferSelect): ConversationEvent {
  const kind = row.kind
  if (!Check(conversationEventKind, kind)) {
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
      avatarKey: bot.avatar_key,
      responsibility: bot.responsibility,
      status: bot.status,
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
    if (row.kind === 'bot') {
      return {
        id: row.id,
        kind: row.kind,
        name: row.botName ?? '智能体',
        avatarKey: row.avatarKey,
        responsibility: row.responsibility ?? '',
        enabled: row.status === 'enabled',
      }
    }
    if (row.kind === 'user') return { id: row.id, kind: row.kind, name: row.userName ?? '成员' }
    throw new Error('数据库中的会话成员类型不合法')
  })
}

async function listConversationPreviews(db: ReadDb, teamId: string, rooms: ConversationRow[]) {
  if (rooms.length === 0) return []
  const ids = rooms.map(({ id }) => id)
  const latest = db
    .select({ body: botMessage.body })
    .from(botMessage)
    .where(and(eq(botMessage.team_id, teamId), eq(botMessage.conversation_id, botConversation.id)))
    .orderBy(desc(botMessage.sequence))
    .limit(1)
    .as('latest_message')
  const [members, messages] = await Promise.all([
    db
      .select({
        roomId: botConversationMember.conversation_id,
        id: bot.id,
        avatarKey: bot.avatar_key,
        status: bot.status,
      })
      .from(botConversationMember)
      .innerJoin(bot, and(eq(bot.id, botConversationMember.member_id), eq(bot.team_id, teamId)))
      .where(
        and(
          eq(botConversationMember.team_id, teamId),
          inArray(botConversationMember.conversation_id, ids),
          eq(botConversationMember.member_kind, 'bot'),
          isNull(botConversationMember.removed_at),
        ),
      )
      .orderBy(asc(botConversationMember.created_at), asc(botConversationMember.id)),
    db
      .select({ roomId: botConversation.id, body: latest.body })
      .from(botConversation)
      .leftJoinLateral(latest, sql`true`)
      .where(and(eq(botConversation.team_id, teamId), inArray(botConversation.id, ids))),
  ])
  const latestByRoom = new Map(messages.map(({ roomId, body }) => [roomId, body]))
  return rooms.map((room) => {
    const body = latestByRoom.get(room.id)
    const preview = Check(botMessageBodySchema, body)
      ? body.blocks
          .flatMap((block) => (block.type === 'tool_activity' ? [] : [block.text]))
          .join(' ')
          .replace(/```[\s\S]*?```/gu, ' ')
          .replace(/[#>*_`|~]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 72)
      : ''
    const bots = members.filter(({ roomId }) => roomId === room.id)
    const leader = bots.find(({ id }) => id === room.leader_bot_id)
    const ordered = leader ? [leader, ...bots.filter(({ id }) => id !== leader.id)] : bots
    return {
      ...viewOf(room),
      botAvatars: ordered
        .slice(0, 4)
        .map(({ id, avatarKey, status }) => ({ id, avatarKey, enabled: status === 'enabled' })),
      lastMessagePreview: preview || (body ? '消息' : null),
    }
  })
}

/**
 * 将已获授权的会话与成员关系组装为公开详情。
 * @param db 数据库或当前事务。
 * @param row 业务用例已校验的会话。
 * @returns 当前成员与会话配置。
 */
export async function readBotConversationView(db: ReadDb, row: ConversationRow, limits = defaultBotRelayLimits) {
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
  const botSettings = await readBotSessionSettings(
    db,
    row,
    members.filter(({ kind }) => kind === 'bot').map(({ id }) => id),
  )
  const relay =
    row.kind === 'group' ? await readActiveBotRelay(db, { teamId: row.team_id, conversationId: row.id }) : undefined
  return {
    ...viewOf(row),
    members,
    tags,
    skillReferences,
    botSettings,
    ...(relay ? { activeRelay: botRelayView(relay, limits) } : {}),
  }
}

function messageReceivers(text: string, members: ConversationMemberView[], explicit: string[], mentionsAll: boolean) {
  const bots = members.filter(({ kind }) => kind === 'bot')
  if (mentionsAll) return bots.map(({ id }) => id)
  const matches = bots
    .flatMap(({ id, name }) => {
      const safeName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      const match = new RegExp(`(?:^|\\s)@${safeName}(?=$|[\\s，。,.!?；;:：、！？])`, 'iu').exec(text)
      return match ? [{ id, index: match.index }] : []
    })
    .sort((a, b) => a.index - b.index)
    .map(({ id }) => id)
  return [...new Set([...explicit, ...matches])]
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

async function lockBotSessionMaintenance(
  tx: BotRunTransaction,
  actor: SessionUser,
  conversationId: string,
  botId: string,
  requireIdle = true,
) {
  const room = await lockWritableBotConversation(tx, actor, conversationId)
  const [member] = await tx
    .select({ id: botConversationMember.id })
    .from(botConversationMember)
    .where(
      and(
        eq(botConversationMember.team_id, room.team_id),
        eq(botConversationMember.conversation_id, room.id),
        eq(botConversationMember.member_kind, 'bot'),
        eq(botConversationMember.member_id, botId),
        isNull(botConversationMember.removed_at),
      ),
    )
  if (!member) throw new ApiError(ERROR_CODES.BOT_NO_RECEIVER, '指定 Bot 不在当前会话')
  if (requireIdle) await requireIdleConversation(tx, room)
  return room
}

async function requireIdleConversation(tx: BotRunTransaction, room: ConversationRow) {
  const [active] = await tx
    .select({ id: botRun.id })
    .from(botRun)
    .where(
      and(
        eq(botRun.team_id, room.team_id),
        eq(botRun.conversation_id, room.id),
        inArray(botRun.status, ['running', 'queued']),
      ),
    )
    .limit(1)
  if (active) throw new ApiError(ERROR_CODES.BOT_RUN_BUSY, '请等待当前会话中的运行结束')
}

/**
 * 组装 Bot 私聊、消息与事件端口。
 * @param db 平台数据库连接。
 * @returns 会话用例，读写均校验当前成员与角色权限。
 */
export function createBotConversationsService(db: Database, limits = defaultBotRelayLimits) {
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
      const items = await listConversationPreviews(
        db,
        teamId,
        rows.slice(0, LIST_PAGE_SIZE).map(({ row }) => row),
      )
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
              isNull(botConversation.forked_from_conversation_id),
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
      return readBotConversationView(db, row, limits)
    },
    /** 按序号读取消息并返回更早一页的游标。 */
    async messages(actor: SessionUser, conversationId: string, before?: string, limit = 50) {
      const row = await requireBotConversation(db, actor, conversationId)
      const previous = sequenceOf(before)
      const branchScope = await activeBotBranchScope(db, row)
      const messages = await db
        .select({ message: botMessage, userName: authUser.name, botName: bot.name, rating: botMessageFeedback.rating })
        .from(botMessage)
        .leftJoin(
          botMessageFeedback,
          and(
            eq(botMessageFeedback.message_id, botMessage.id),
            eq(botMessageFeedback.user_id, actor.id),
            eq(botMessageFeedback.team_id, row.team_id),
          ),
        )
        .leftJoin(authUser, and(eq(authUser.id, botMessage.speaker_id), eq(botMessage.speaker_kind, 'user')))
        .leftJoin(
          bot,
          and(eq(bot.id, botMessage.speaker_id), eq(bot.team_id, row.team_id), eq(botMessage.speaker_kind, 'bot')),
        )
        .where(and(branchScope, previous === undefined ? undefined : lt(botMessage.sequence, previous)))
        .orderBy(desc(botMessage.sequence))
        .limit(limit + 1)
      const visible = messages.slice(0, limit)
      const siblings =
        row.kind === 'direct'
          ? await readBotBranchSiblings(
              db,
              row,
              visible.map((item) => item.message),
            )
          : new Map()
      const page = visible.map((item): ConversationMessage => {
        if (item.rating !== null && item.rating !== 'helpful' && item.rating !== 'unhelpful')
          throw new Error('数据库中的消息评价不合法')
        const branchSiblings = siblings.get(item.message.id)
        return {
          ...messageView(item.message, item.userName ?? item.botName),
          feedback: item.rating,
          ...(branchSiblings ? { branchSiblings } : {}),
        }
      })
      return { nextBefore: messages.length > limit ? (page.at(-1)?.sequence ?? null) : null, items: page.reverse() }
    },
    /**
     * 保存当前成员对 Bot 回复的评价，重复选择由客户端提交 null 取消。
     * @param actor 当前用户。
     * @param conversationId 会话标识。
     * @param messageId Bot 回复标识。
     * @param rating 好评、差评或取消。
     * @returns 消息标识及保存后的选择。
     * @throws 无会话访问权限、只读角色或目标非 Bot 回复时返回业务错误。
     */
    async feedback(
      actor: SessionUser,
      conversationId: string,
      messageId: string,
      rating: 'helpful' | 'unhelpful' | null,
    ) {
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        const [message] = await tx
          .select({ kind: botMessage.speaker_kind })
          .from(botMessage)
          .where(
            and(
              eq(botMessage.id, messageId),
              eq(botMessage.conversation_id, room.id),
              eq(botMessage.team_id, room.team_id),
            ),
          )
        if (message?.kind !== 'bot') throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '只能评价当前会话的 Bot 回复')
        const scope = and(
          eq(botMessageFeedback.message_id, messageId),
          eq(botMessageFeedback.user_id, actor.id),
          eq(botMessageFeedback.team_id, room.team_id),
        )
        if (rating === null) await tx.delete(botMessageFeedback).where(scope)
        else
          await tx
            .insert(botMessageFeedback)
            .values({
              team_id: room.team_id,
              conversation_id: room.id,
              message_id: messageId,
              user_id: actor.id,
              rating,
            })
            .onConflictDoUpdate({
              target: [botMessageFeedback.message_id, botMessageFeedback.user_id],
              set: { rating, updated_at: sql`clock_timestamp()` },
            })
        return { id: messageId, rating }
      })
    },
    /**
     * 在私聊中以新的文本重发自己的消息，保留原分支与关联运行。
     * @param actor 原消息作者。
     * @param conversationId 当前私聊。
     * @param messageId 当前分支上要编辑的消息。
     * @param input 新文本与客户端去重标识。
     * @returns 新分支上的消息和排队运行。
     */
    async editResend(
      actor: SessionUser,
      conversationId: string,
      messageId: string,
      input: { text: string; clientRequestId: string },
    ): Promise<SendBotMessageResult> {
      const text = redactChatContent(input.text.trim())
      if (!text) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '消息不能为空')
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        if (room.kind !== 'direct') throw new ApiError(ERROR_CODES.BOT_BRANCH_UNSUPPORTED, '只有私聊支持编辑重发')
        const scope = and(eq(botMessage.team_id, room.team_id), eq(botMessage.conversation_id, room.id))
        const [original] = await tx
          .select()
          .from(botMessage)
          .where(and(scope, eq(botMessage.id, messageId)))
        if (!original || original.speaker_kind !== 'user' || original.speaker_id !== actor.id)
          throw new ApiError(ERROR_CODES.NOT_FOUND, '找不到你可以编辑的消息')
        const rootId = original.edited_from_message_id ?? original.id
        const [same] = await tx
          .select()
          .from(botMessage)
          .where(and(scope, eq(botMessage.client_request_id, input.clientRequestId)))
        if (same) {
          const message = messageView(same, actor.name)
          if (
            same.speaker_id !== actor.id ||
            same.edited_from_message_id !== rootId ||
            !same.run_id ||
            message.body.blocks[0]?.type !== 'text' ||
            message.body.blocks[0].text !== text
          ) {
            throw new ApiError(ERROR_CODES.IDEMPOTENCY_CONFLICT, '该请求标识已用于另一条消息')
          }
          return { message, runId: same.run_id, delivery: 'queued' }
        }
        await requireIdleConversation(tx, room)
        const visibleScope = await activeBotBranchScope(tx, room)
        const [visible] = await tx
          .select({ id: botMessage.id })
          .from(botMessage)
          .where(and(visibleScope, eq(botMessage.id, messageId)))
        if (!visible) throw new ApiError(ERROR_CODES.NOT_FOUND, '消息不在当前分支')
        const [root] = await tx
          .select({ sequence: botMessage.sequence })
          .from(botMessage)
          .where(and(scope, eq(botMessage.id, rootId)))
        const target = (await readMembers(tx, room)).find((member) => member.kind === 'bot')
        if (!root || !target) throw new ApiError(ERROR_CODES.BOT_NO_RECEIVER, '没有可用的智能体承接重发')
        await requireRunnableBot(tx, room.team_id, target.id, { allowOffline: true })
        const [latest] = await tx
          .select({ sequence: botMessage.sequence })
          .from(botMessage)
          .where(scope)
          .orderBy(desc(botMessage.sequence))
          .limit(1)
        const branchId = randomUUID()
        const [replacement] = await tx
          .insert(botMessage)
          .values({
            id: branchId,
            team_id: room.team_id,
            conversation_id: room.id,
            sequence: (latest?.sequence ?? 0n) + 1n,
            speaker_kind: 'user',
            speaker_id: actor.id,
            body: { blocks: [{ type: 'text', text }] },
            client_request_id: input.clientRequestId,
            branch_id: branchId,
            edited_from_message_id: rootId,
          })
          .returning()
        if (!replacement) throw new Error('未能写入编辑后的消息')
        await setBotBranch(tx, room, branchId, root.sequence)
        const run = await enqueueBotRun(tx, {
          team_id: room.team_id,
          conversation_id: room.id,
          bot_id: target.id,
          trigger_user_id: actor.id,
          trigger_message_id: replacement.id,
          input_version: 0,
        })
        await tx
          .update(botMessage)
          .set({ run_id: run.id, updated_at: new Date() })
          .where(and(scope, eq(botMessage.id, branchId)))
        await tx
          .update(botConversation)
          .set({ last_message_at: replacement.created_at })
          .where(eq(botConversation.id, room.id))
        return {
          message: messageView({ ...replacement, run_id: run.id }, actor.name),
          runId: run.id,
          delivery: 'queued',
        }
      })
    },
    /**
     * 选择当前编辑点相邻的版本，并切换会话树。
     * @param actor 有写权限的会话成员。
     * @param conversationId 当前私聊。
     * @param input 已显示的消息和切换方向。
     * @returns 新分支标识；不存在相邻版本时拒绝。
     */
    async switchBranch(
      actor: SessionUser,
      conversationId: string,
      input: { messageId: string; direction: 'previous' | 'next' },
    ) {
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        if (room.kind !== 'direct') throw new ApiError(ERROR_CODES.BOT_BRANCH_UNSUPPORTED, '只有私聊支持切换分支')
        await requireIdleConversation(tx, room)
        const values = await botBranchVersions(tx, room, input.messageId)
        const index = values.findIndex(({ id }) => id === input.messageId)
        const target = index === -1 ? undefined : values[index + (input.direction === 'next' ? 1 : -1)]
        if (!target) throw new ApiError(ERROR_CODES.NOT_FOUND, '没有相邻的会话分支')
        await setBotBranch(tx, room, target.branch)
        return { branchId: target.branch }
      })
    },
    /**
     * 复制当前会话分支中指定位置以前的消息和上下文。
     * @param actor 有发消息权限的源会话成员。
     * @param conversationId 源会话。
     * @param input 复制截止的会话消息和新名称。
     * @returns 独立的新会话详情。
     */
    async fork(actor: SessionUser, conversationId: string, input: { messageId: string; name?: string }) {
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        const forked = await forkBotConversation(tx, room, actor.id, input)
        return readBotConversationView(tx, forked)
      })
    },
    /**
     * 为当前会话的 Bot 保存模型与思考等级覆盖。
     * @param actor 当前有写权限的成员。
     * @param conversationId 目标会话。
     * @param botId 当前会话内的智能体。
     * @param input 与当前 Bot 连接兼容的覆盖设置。
     * @returns 已保存的设置，从下一次运行起生效。
     */
    async settings(
      actor: SessionUser,
      conversationId: string,
      botId: string,
      input: Parameters<typeof saveBotSessionSetting>[2],
    ) {
      return db.transaction(async (tx) => {
        const room = await lockBotSessionMaintenance(tx, actor, conversationId, botId, false)
        return saveBotSessionSetting(tx, { teamId: room.team_id, conversationId, botId, actorId: actor.id }, input)
      })
    },
    /**
     * 为指定 Bot 的会话树排队一次压缩。
     * @param actor 当前有写权限的会话成员。
     * @param conversationId 会话标识。
     * @param botId 该会话内的 Bot。
     * @returns 运行标识；有在途运行或没有有效会话树时拒绝。
     */
    async compact(actor: SessionUser, conversationId: string, botId: string) {
      return db.transaction(async (tx) => {
        const room = await lockBotSessionMaintenance(tx, actor, conversationId, botId)
        const [session] = await tx
          .select({ status: botSession.status, leaf: botSession.leaf_entry_id })
          .from(botSession)
          .where(
            and(
              eq(botSession.team_id, room.team_id),
              eq(botSession.conversation_id, room.id),
              eq(botSession.bot_id, botId),
            ),
          )
        if (!session?.leaf || session.status !== 'active')
          throw new ApiError(ERROR_CODES.BOT_SESSION_UNAVAILABLE, '当前没有可以压缩的会话记录')
        await requireRunnableBot(tx, room.team_id, botId, { allowOffline: true })
        const run = await enqueueBotRun(tx, {
          team_id: room.team_id,
          conversation_id: room.id,
          bot_id: botId,
          trigger_user_id: actor.id,
          input_version: 1,
          kind: 'compact',
        })
        return { runId: run.id }
      })
    },
    /**
     * 移除损坏的单 Bot 会话树，使其下次从房间记录重新播种。
     * @param actor 具有会话访问权限的团队管理员。
     * @param conversationId 会话标识。
     * @param botId 要恢复的会话成员。
     * @returns 恢复的 Bot 标识；非损坏状态或仍有运行时拒绝。
     */
    async reseed(actor: SessionUser, conversationId: string, botId: string) {
      return db.transaction(async (tx) => {
        const room = await lockBotSessionMaintenance(tx, actor, conversationId, botId)
        await requireTeamMember(tx, actor.id, room.team_id, ['admin'])
        const [session] = await tx
          .delete(botSession)
          .where(
            and(
              eq(botSession.team_id, room.team_id),
              eq(botSession.conversation_id, room.id),
              eq(botSession.bot_id, botId),
              eq(botSession.status, 'corrupted'),
            ),
          )
          .returning({ id: botSession.id })
        if (!session) throw new ApiError(ERROR_CODES.BOT_SESSION_UNAVAILABLE, '没有需要重新播种的损坏会话')
        await tx
          .delete(botSessionEntry)
          .where(and(eq(botSessionEntry.team_id, room.team_id), eq(botSessionEntry.session_id, session.id)))
        return { botId }
      })
    },
    /** 发送消息并排队；重复请求复用已保存的同一次运行。 */
    async send(actor: SessionUser, conversationId: string, input: SendBotMessageInput): Promise<SendBotMessageResult> {
      const sourceText = redactChatContent(input.text.trim())
      if (!sourceText) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '消息不能为空')
      const deliveryMode = input.deliveryMode ?? 'auto'
      const mentionsAll = input.mentionAll || /(?:^|\s)@全部(?=$|[\s，。,.!?；;:：、！？])/u.test(sourceText)
      const references = {
        mentionBotIds: [...new Set(input.mentionBotIds ?? [])],
        mentionAll: mentionsAll,
        skillIds: [...(input.skillIds ?? [])].sort(),
        deliveryMode,
      }
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
            (message.body.references?.promptTemplate?.sourceText ?? message.body.blocks[0].text) !== sourceText ||
            message.body.references?.promptTemplate?.id !== input.promptTemplateId ||
            (message.body.references?.mentionBotIds ?? []).join(',') !== references.mentionBotIds.join(',') ||
            (message.body.references?.mentionAll ?? false) !== references.mentionAll ||
            (message.body.references?.deliveryMode ?? 'auto') !== deliveryMode ||
            (message.body.references?.skillIds ?? []).join(',') !== references.skillIds.join(',') ||
            !same.run_id
          ) {
            throw new ApiError(ERROR_CODES.IDEMPOTENCY_CONFLICT, '该请求标识已用于另一条消息')
          }
          const [queuedInput] = await tx
            .select({ mode: botRunInput.delivery_mode, status: botRunInput.status })
            .from(botRunInput)
            .where(and(eq(botRunInput.team_id, conversation.team_id), eq(botRunInput.message_id, same.id)))
          const mode = queuedInput?.status === 'requeued' ? undefined : queuedInput?.mode
          const delivery = mode === 'steer' || mode === 'follow_up' ? mode : 'queued'
          return { message, runId: same.run_id, delivery }
        }
        const template = input.promptTemplateId
          ? await requireBotPromptTemplate(tx, conversation.team_id, input.promptTemplateId)
          : undefined
        const args = template ? sourceText.replace(new RegExp(`^/${template.name}(?:\\s+|$)`, 'u'), '').trim() : ''
        const text = template
          ? redactChatContent(
              template.body.includes('$ARGUMENTS')
                ? template.body.replaceAll('$ARGUMENTS', () => args)
                : [template.body, args].filter(Boolean).join('\n\n'),
            ).trim()
          : sourceText
        if (!text || text.length > 16_000)
          throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '模板展开后消息为零或超过长度上限')
        const members = await readMembers(tx, conversation)
        const group = conversation.kind === 'group'
        const botMembers = new Set(members.filter(({ kind }) => kind === 'bot').map(({ id }) => id))
        if (references.mentionBotIds.some((id) => !botMembers.has(id))) {
          throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, '引用的智能体不是当前会话成员')
        }
        const all = group && references.mentionAll
        const selected = group
          ? messageReceivers(text, members, references.mentionBotIds, all)
          : references.mentionBotIds
        const targetId = selected[0] ?? (group ? conversation.leader_bot_id : [...botMembers][0])
        if (!targetId) throw new ApiError(ERROR_CODES.BOT_NO_RECEIVER, '没有智能体承接这条消息')
        const recipients = selected.length ? selected : [targetId]
        if (!group)
          await requireRunnableBot(tx, conversation.team_id, targetId, { allowOffline: !input.skillIds?.length })
        const relayScope = { teamId: conversation.team_id, conversationId }
        let relay = group ? await readActiveBotRelay(tx, relayScope) : undefined
        if (relay?.status === 'paused') {
          const previous = await latestBotRelayRun(tx, relay)
          await updateBotRelay(
            tx,
            relay,
            { status: 'finished', end_reason: 'ended_by_member', pending_bot_ids: [] },
            previous?.id,
          )
          relay = undefined
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
            branch_id: conversation.active_branch_id,
            body: {
              blocks: [{ type: 'text', text }],
              references: {
                ...references,
                ...(group ? { relayRecipients: recipients } : {}),
                ...(template ? { promptTemplate: { id: template.id, name: template.name, sourceText } } : {}),
              },
            },
          })
          .returning()
        if (!message) throw new Error('未能保存 Bot 会话消息')
        // 运行的工具授权固定为触发人，其他成员的补充要求按各自身份排队。
        const [active] =
          references.skillIds.length || recipients.length !== 1 || all
            ? []
            : await tx
                .select({ id: botRun.id })
                .from(botRun)
                .where(
                  and(
                    eq(botRun.team_id, conversation.team_id),
                    eq(botRun.conversation_id, conversationId),
                    eq(botRun.bot_id, targetId),
                    eq(botRun.status, 'running'),
                    eq(botRun.stop_requested, false),
                    eq(botRun.trigger_user_id, actor.id),
                    inArray(botRun.kind, ['task', 'reply']),
                  ),
                )
                .for('update')
        if (!active && (await isBotBudgetExhausted(tx, conversation.team_id))) {
          throw new ApiError(ERROR_CODES.BOT_BUDGET_EXHAUSTED, '团队本月 Bot 预算已用完')
        }
        const delivery = active ? (deliveryMode === 'steer' ? 'steer' : 'follow_up') : 'queued'
        const createdRelay =
          group && !active && !relay
            ? await openBotRelay(tx, { ...relayScope, messageId: message.id, actorId: actor.id, receivers: recipients })
            : undefined
        const run =
          active ??
          (await enqueueBotRun(tx, {
            team_id: conversation.team_id,
            bot_id: targetId,
            conversation_id: conversationId,
            trigger_user_id: actor.id,
            trigger_message_id: message.id,
            input_version: 0,
            ...(group
              ? { relay_id: createdRelay?.id, hop: 0, relay_role: all ? 'all' : selected.length ? 'mention' : 'leader' }
              : {}),
          }))
        if (delivery !== 'queued') {
          await tx.insert(botRunInput).values({
            team_id: conversation.team_id,
            run_id: run.id,
            message_id: message.id,
            delivery_mode: delivery,
          })
        }
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
        return {
          message: messageView({ ...message, run_id: run.id }, actor.name),
          runId: run.id,
          delivery,
          ...(createdRelay ? { relay: botRelayView(createdRelay, limits) } : {}),
        }
      })
    },
    /**
     * 查询增量事件和当前在途运行，可限定为会话内的一次运行。
     * @param actor 当前会话成员。
     * @param conversationId 会话标识。
     * @param filters 会话事件游标和可选的运行标识。
     * @returns 按序号排列的事件、游标和在途运行；过旧游标提示重新同步。
     */
    async events(actor: SessionUser, conversationId: string, filters: { after?: string; runId?: string }) {
      const conversation = await requireBotConversation(db, actor, conversationId)
      const cursor = sequenceOf(filters.after)
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
        .where(
          and(
            eventScope,
            cursor !== undefined && !resetRequired ? gt(botEvent.sequence, cursor) : undefined,
            filters.runId ? eq(botEvent.run_id, filters.runId) : undefined,
          ),
        )
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
            filters.runId ? eq(botRun.id, filters.runId) : undefined,
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
      const relay =
        conversation.kind === 'group'
          ? await readActiveBotRelay(db, { teamId: conversation.team_id, conversationId })
          : undefined
      return {
        ...(relay ? { activeRelay: botRelayView(relay, limits) } : {}),
        items: rows.map(toEvent),
        cursor: (rows.at(-1)?.sequence ?? cursor ?? 0n).toString(),
        resetRequired,
        activeRuns,
      }
    },
  }
}

export type BotConversationsService = ReturnType<typeof createBotConversationsService>
