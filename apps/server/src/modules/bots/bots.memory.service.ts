import { Type } from 'typebox'
import { Check } from 'typebox/value'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { botConversation, botConversationMember } from '../collaboration/bot-conversations.tables.ts'
import { getCurrentBotActor } from '../identity/identity.bot-delegation.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { authUser } from '../identity/identity.tables.ts'
import type {
  BotMemoryCreateInput,
  BotMemoryFilters,
  BotMemoryUpdateInput,
  BotMemoryView,
} from './bots.memory.schema.ts'
import { enqueueBotMemoryJobs } from './bots.memory-jobs.ts'
import { bot, botMemory } from './bots.tables.ts'
import {
  activeMemory,
  addScopedMemory,
  lockMemoryScope,
  memorySearchCondition,
  patchScopedMemory,
  type MemoryRow,
} from './runtime/memory-store.ts'

const PAGE_SIZE = 40
const consolidationDetail = Type.Object({
  from: Type.String(),
  to: Type.String(),
  conversationIds: Type.Array(Type.String()),
  mergedMemoryIds: Type.Array(Type.String()),
})
type ReadDb = Pick<Database, 'select'>

function unavailable(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, '记忆不存在或不可见')
}

function access(row: MemoryRow, userId: string, role: string) {
  if (role === 'viewer') return { canEdit: false, canRemove: false }
  if (role === 'admin') return { canEdit: true, canRemove: true }
  const canEdit = row.scope === 'user' && row.user_id === userId
  return { canEdit, canRemove: canEdit || (row.scope === 'bot' && row.source_user_id === userId) }
}

function detailQuery(db: ReadDb, actor: SessionUser) {
  return db
    .select({
      row: botMemory,
      botName: bot.name,
      sourceUserName: authUser.name,
      sourceConversationId: botConversation.id,
      sourceConversationName: botConversation.name,
    })
    .from(botMemory)
    .innerJoin(bot, and(eq(bot.team_id, botMemory.team_id), eq(bot.id, botMemory.bot_id)))
    .leftJoin(authUser, eq(authUser.id, botMemory.source_user_id))
    .leftJoin(
      botConversationMember,
      and(
        eq(botConversationMember.team_id, botMemory.team_id),
        eq(botConversationMember.conversation_id, botMemory.source_conversation_id),
        eq(botConversationMember.member_kind, 'user'),
        eq(botConversationMember.member_id, actor.id),
        isNull(botConversationMember.removed_at),
      ),
    )
    .leftJoin(
      botConversation,
      and(
        eq(botConversation.team_id, botMemory.team_id),
        eq(botConversation.id, botConversationMember.conversation_id),
      ),
    )
}

type MemoryDetailRow = Awaited<ReturnType<typeof detailQuery>>[number]
function view(detail: MemoryDetailRow, actor: SessionUser, role: string): BotMemoryView {
  const { row, ...metadata } = detail
  if (row.scope !== 'user' && row.scope !== 'bot') throw new Error('数据库中的记忆范围不合法')
  const consolidated = row.source_kind === 'consolidation'
  const sourceDetail =
    consolidated && Check(consolidationDetail, row.source_detail)
      ? {
          from: row.source_detail.from,
          to: row.source_detail.to,
          conversationCount: row.source_detail.conversationIds.length,
          mergedMemoryIds: row.source_detail.mergedMemoryIds,
        }
      : undefined
  return {
    id: row.id,
    source: consolidated
      ? { kind: 'consolidation', ...(sourceDetail ? { detail: sourceDetail } : {}) }
      : { kind: 'conversation' },
    botId: row.bot_id,
    scope: row.scope,
    essential: row.essential,
    content: row.content,
    updatedAt: row.updated_at.toISOString(),
    ...metadata,
    ...access(row, actor.id, role),
  }
}

function checkDelegatedBot(botId: string) {
  const delegated = getCurrentBotActor()
  if (delegated && delegated.viaBotId !== botId) unavailable()
}

async function memoryById(db: ReadDb, id: string) {
  const [row] = await db
    .select()
    .from(botMemory)
    .where(and(eq(botMemory.id, id), activeMemory))
  if (!row) unavailable()
  checkDelegatedBot(row.bot_id)
  return row
}

function visibleInTeam(teamId: string, actorId: string) {
  return and(
    activeMemory,
    eq(botMemory.team_id, teamId),
    or(eq(botMemory.scope, 'bot'), eq(botMemory.user_id, actorId)),
  )
}

async function getView(db: ReadDb, actor: SessionUser, id: string, role: string) {
  const [detail] = await detailQuery(db, actor).where(eq(botMemory.id, id))
  if (!detail) unavailable()
  return view(detail, actor, role)
}

/** 组装按团队、当前成员和 Bot 过滤的长期记忆管理。 */
export function createBotMemoryService(db: Database) {
  return {
    /**
     * 为当前 Bot 排入当天的记忆整理。
     * @param actor 本团队管理员。
     * @param botId 需要整理的 Bot 标识。
     * @returns 本次运行标识；忙碌或本日已整理时返回 null。
     */
    async consolidate(actor: SessionUser, botId: string) {
      const [record] = await db.select({ teamId: bot.team_id }).from(bot).where(eq(bot.id, botId))
      if (!record) unavailable()
      await requireTeamMember(db, actor.id, record.teamId, ['admin'])
      const [job] = await enqueueBotMemoryJobs(db, { teamId: record.teamId, botId, actorId: actor.id })
      return { runId: job?.id ?? null }
    },
    /** 列出本人的用户画像和团队 Bot 笔记，来源会话只对会话成员显示。 */
    async list(actor: SessionUser, teamId: string, filters: BotMemoryFilters) {
      const { role } = await requireTeamMember(db, actor.id, teamId)
      const delegatedBot = getCurrentBotActor()?.viaBotId
      const scope = and(
        delegatedBot ? eq(botMemory.bot_id, delegatedBot) : undefined,
        visibleInTeam(teamId, actor.id),
        filters.botId ? eq(botMemory.bot_id, filters.botId) : undefined,
        filters.scope ? eq(botMemory.scope, filters.scope) : undefined,
      )
      const [cursor] = filters.cursor
        ? await db
            .select({ time: botMemory.updated_at, id: botMemory.id })
            .from(botMemory)
            .where(and(scope, eq(botMemory.id, filters.cursor)))
        : []
      if (filters.cursor && !cursor) unavailable()
      const rows = await detailQuery(db, actor)
        .where(
          and(
            scope,
            memorySearchCondition(filters.query).filter,
            cursor
              ? or(
                  lt(botMemory.updated_at, cursor.time),
                  and(eq(botMemory.updated_at, cursor.time), lt(botMemory.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(botMemory.updated_at), desc(botMemory.id))
        .limit(PAGE_SIZE + 1)
      const items = rows.slice(0, PAGE_SIZE).map((row) => view(row, actor, role))
      return { items, nextCursor: rows.length > PAGE_SIZE ? (items.at(-1)?.id ?? null) : null }
    },
    /** 新增当前成员的画像；管理员也可为指定 Bot 新增团队笔记。 */
    create(actor: SessionUser, teamId: string, input: BotMemoryCreateInput) {
      return db.transaction(async (tx) => {
        checkDelegatedBot(input.botId)
        const { role } = await requireTeamMember(
          tx,
          actor.id,
          teamId,
          input.scope === 'bot' ? ['admin'] : ['admin', 'developer'],
        )
        const [target] = await tx
          .select({ id: bot.id })
          .from(bot)
          .where(and(eq(bot.team_id, teamId), eq(bot.id, input.botId)))
        if (!target) throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, '智能体不存在或不可见')
        const scope = { teamId, botId: target.id, userId: actor.id }
        await lockMemoryScope(tx, scope)
        const saved = await addScopedMemory(tx, scope, input, { userId: actor.id, kind: 'user' })
        return getView(tx, actor, saved.id, role)
      })
    },
    /** 允许管理员或用户画像本人修改正文和常驻状态。 */
    update(actor: SessionUser, id: string, input: BotMemoryUpdateInput) {
      return db.transaction(async (tx) => {
        const first = await memoryById(tx, id)
        const { role } = await requireTeamMember(tx, actor.id, first.team_id, ['admin', 'developer'])
        if (!access(first, actor.id, role).canEdit) unavailable()
        await lockMemoryScope(tx, { teamId: first.team_id, botId: first.bot_id })
        const row = await memoryById(tx, id)
        const saved = await patchScopedMemory(tx, row, input, 'user')
        return getView(tx, actor, saved.id, role)
      })
    },
    /** 删除本人画像、本人对话产生的 Bot 笔记或管理员可维护的条目。 */
    remove(actor: SessionUser, id: string) {
      return db.transaction(async (tx) => {
        const row = await memoryById(tx, id)
        const { role } = await requireTeamMember(tx, actor.id, row.team_id, ['admin', 'developer'])
        if (!access(row, actor.id, role).canRemove) unavailable()
        await lockMemoryScope(tx, { teamId: row.team_id, botId: row.bot_id })
        const [deleted] = await tx
          .delete(botMemory)
          .where(and(eq(botMemory.team_id, row.team_id), eq(botMemory.id, id)))
          .returning({ memoryId: botMemory.id })
        if (!deleted) unavailable()
        return deleted
      })
    },
  }
}
export type BotMemoryService = ReturnType<typeof createBotMemoryService>
