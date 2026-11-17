import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { requestBotRunStop, type BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import { requireRunnableBot } from '../bots/bots.service.ts'
import { bot, botRun } from '../bots/bots.tables.ts'
import { redactChatContent } from '../bots/runtime/content.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { teamMember } from '../identity/identity.tables.ts'
import { botTask } from '../tasks/bot-tasks.tables.ts'
import { lockWritableBotConversation, readBotConversationView } from './bot-conversations.service.ts'
import { botConversation, botConversationMember } from './bot-conversations.tables.ts'
import type { BotGroupMemberInput, CreateBotGroupInput, UpdateBotGroupInput } from './bot-groups.schema.ts'

type ConversationRow = typeof botConversation.$inferSelect

function validateName(value: string) {
  const name = redactChatContent(value.trim()).slice(0, 80)
  if (!name) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请输入群组名称')
  return name
}

function requireGroup(room: ConversationRow) {
  if (room.kind !== 'group') throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '该操作只适用于群组会话')
}

function groupMemberScope(row: ConversationRow, input: BotGroupMemberInput) {
  return and(
    eq(botConversationMember.team_id, row.team_id),
    eq(botConversationMember.conversation_id, row.id),
    eq(botConversationMember.member_kind, input.kind),
    eq(botConversationMember.member_id, input.memberId),
    isNull(botConversationMember.removed_at),
  )
}

async function verifyMemberTargets(tx: BotRunTransaction, teamId: string, users: string[], bots: string[]) {
  const userRows = users.length
    ? await tx
        .select({ id: teamMember.user_id })
        .from(teamMember)
        .where(and(eq(teamMember.team_id, teamId), eq(teamMember.status, 'active'), inArray(teamMember.user_id, users)))
        .orderBy(asc(teamMember.user_id))
        .for('share')
    : []
  if (userRows.length !== users.length) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '群组成员须是本团队的有效用户')
  const botRows = bots.length
    ? await tx
        .select({ id: bot.id })
        .from(bot)
        .where(and(eq(bot.team_id, teamId), inArray(bot.id, bots)))
        .orderBy(asc(bot.id))
    : []
  if (botRows.length !== bots.length) throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, '智能体不属于当前团队或已不可见')
}

async function stopRemovedMemberRuns(
  tx: BotRunTransaction,
  row: ConversationRow,
  input: BotGroupMemberInput,
  actorId: string,
) {
  const running = await tx
    .select({ id: botRun.id })
    .from(botRun)
    .where(
      and(
        eq(botRun.team_id, row.team_id),
        eq(botRun.conversation_id, row.id),
        eq(input.kind === 'bot' ? botRun.bot_id : botRun.trigger_user_id, input.memberId),
        inArray(botRun.status, ['queued', 'running']),
      ),
    )
    .orderBy(asc(botRun.id))
    .for('update')
  for (const run of running) await requestBotRunStop(tx, run.id, actorId, input.kind === 'user')
  if (input.kind !== 'bot') return
  await tx
    .update(botTask)
    .set({
      blocked: true,
      status: 'waiting',
      wait_reason: 'executor_unavailable',
      version: sql`${botTask.version} + 1`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(botTask.team_id, row.team_id),
        eq(botTask.conversation_id, row.id),
        eq(botTask.executor_bot_id, input.memberId),
        inArray(botTask.status, ['pending', 'in_progress', 'waiting']),
      ),
    )
}

/**
 * 组装团队群组创建、设置和成员维护用例。
 * @param db 平台数据库。
 * @returns 所有写操作按会话加锁，并在事务内校验同一团队的成员和 Leader。
 */
export function createBotGroupsService(db: Database) {
  return {
    /** 创建包含当前操作者的群组，Leader 必须是群组内可用的 Bot。 */
    async create(actor: SessionUser, teamId: string, input: CreateBotGroupInput) {
      return db.transaction(async (tx) => {
        await requireTeamMember(tx, actor.id, teamId, ['admin', 'developer'])
        if (!input.botIds.includes(input.leaderBotId)) {
          throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Leader 必须是群组内的智能体')
        }
        const userIds = [...new Set([actor.id, ...input.memberUserIds])]
        await verifyMemberTargets(tx, teamId, userIds, input.botIds)
        await requireRunnableBot(tx, teamId, input.leaderBotId)
        const [created] = await tx
          .insert(botConversation)
          .values({
            team_id: teamId,
            name: validateName(input.name),
            kind: 'group',
            leader_bot_id: input.leaderBotId,
            responsibility: redactChatContent(input.responsibility?.trim() ?? ''),
            instructions: redactChatContent(input.instructions?.trim() ?? ''),
            created_by: actor.id,
          })
          .returning()
        if (!created) throw new Error('未能创建 Bot 群组')
        await tx.insert(botConversationMember).values([
          ...userIds.map((id) => ({
            team_id: teamId,
            conversation_id: created.id,
            member_kind: 'user',
            member_id: id,
            added_by: actor.id,
          })),
          ...input.botIds.map((id) => ({
            team_id: teamId,
            conversation_id: created.id,
            member_kind: 'bot',
            member_id: id,
            added_by: actor.id,
          })),
        ])
        return readBotConversationView(tx, created)
      })
    },
    /** 更新当前群组设置；更换 Leader 不更新已有任务执行者。 */
    async update(actor: SessionUser, conversationId: string, input: UpdateBotGroupInput) {
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        requireGroup(room)
        if (input.leaderBotId && input.leaderBotId !== room.leader_bot_id) {
          const [leader] = await tx
            .select({ id: botConversationMember.id })
            .from(botConversationMember)
            .where(groupMemberScope(room, { kind: 'bot', memberId: input.leaderBotId }))
          if (!leader) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Leader 必须是群组内的智能体')
          await requireRunnableBot(tx, room.team_id, input.leaderBotId)
        }
        const [updated] = await tx
          .update(botConversation)
          .set({
            name: input.name === undefined ? undefined : validateName(input.name),
            leader_bot_id: input.leaderBotId,
            responsibility:
              input.responsibility === undefined ? undefined : redactChatContent(input.responsibility.trim()),
            instructions: input.instructions === undefined ? undefined : redactChatContent(input.instructions.trim()),
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(botConversation.id, room.id), eq(botConversation.team_id, room.team_id)))
          .returning()
        if (!updated) throw new Error('更新的 Bot 会话不存在')
        return readBotConversationView(tx, updated)
      })
    },
    /** 增加群组成员，从加入起可读取该会话的全部历史。 */
    async add(actor: SessionUser, conversationId: string, input: BotGroupMemberInput) {
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        requireGroup(room)
        const activeMembers = await tx
          .select({ id: botConversationMember.id })
          .from(botConversationMember)
          .where(
            and(
              eq(botConversationMember.team_id, room.team_id),
              eq(botConversationMember.conversation_id, room.id),
              isNull(botConversationMember.removed_at),
            ),
          )
          .limit(200)
        if (activeMembers.length >= 200) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '群组成员已达到上限')
        await verifyMemberTargets(
          tx,
          room.team_id,
          input.kind === 'user' ? [input.memberId] : [],
          input.kind === 'bot' ? [input.memberId] : [],
        )
        await tx
          .insert(botConversationMember)
          .values({
            team_id: room.team_id,
            conversation_id: room.id,
            member_id: input.memberId,
            member_kind: input.kind,
            added_by: actor.id,
          })
          .onConflictDoNothing()
        return readBotConversationView(tx, room)
      })
    },
    /** 移出成员并终止其在途运行；要先为群组指定新的 Leader 才能移出旧 Leader。 */
    async remove(actor: SessionUser, conversationId: string, input: BotGroupMemberInput) {
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        requireGroup(room)
        if (input.memberId === room.leader_bot_id && input.kind === 'bot') {
          throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '请先为群组指定新的 Leader')
        }
        if (input.memberId === actor.id && input.kind === 'user') {
          throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '请由其他具备修改权限的群组成员移出你')
        }
        const [removed] = await tx
          .update(botConversationMember)
          .set({
            removed_at: sql`clock_timestamp()`,
            updated_at: sql`clock_timestamp()`,
          })
          .where(groupMemberScope(room, input))
          .returning({ id: botConversationMember.id })
        if (!removed) throw new ApiError(ERROR_CODES.NOT_FOUND, '该成员已不在群组中')
        await stopRemovedMemberRuns(tx, room, input, actor.id)
        return readBotConversationView(tx, room)
      })
    },
  }
}

export type BotGroupsService = ReturnType<typeof createBotGroupsService>
