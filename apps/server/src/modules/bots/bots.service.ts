import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { botConversationMember } from '../collaboration/bot-conversations.tables.ts'
import { insertActivity } from '../collaboration/collaboration.repository.ts'
import { credential } from '../configuration/configuration.tables.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import { authUser, teamMember } from '../identity/identity.tables.ts'
import { skill } from '../knowledge/knowledge.tables.ts'
import { botTask } from '../tasks/bot-tasks.tables.ts'
import { stopRunsForBot, type BotRunTransaction } from './bots.run-queue.repository.ts'
import type { BindBotModelInput, BotListFilters, BotView, CreateBotInput, UpdateBotInput } from './bots.schema.ts'
import { bot, botModelCatalog, botModelConnection, botRun, botSkill } from './bots.tables.ts'
import { botAvailability, toBotRunSummary, toBotView, type BotViewRecord } from './bots.view.ts'

const PAGE_SIZE = 30
const BOT_EDIT_ROLES: TeamRole[] = ['admin', 'developer']
const WORKER_ONLINE_WINDOW_SECONDS = 90

type BotRead = Pick<Database, 'select'>
type BotRow = typeof bot.$inferSelect

function errorsForNameConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '团队中已有同名 Bot')
  throw error
}

function nameAndResponsibility(input: Pick<CreateBotInput, 'name' | 'responsibility'>) {
  const name = input.name.trim()
  const responsibility = input.responsibility.trim()
  if (!name || !responsibility) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请填写名称与职责')
  return { name, responsibility }
}

async function requireOwner(tx: BotRunTransaction, teamId: string, userId: string) {
  const [owner] = await tx
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.team_id, teamId), eq(teamMember.user_id, userId), eq(teamMember.status, 'active')))
    .for('update')
  if (!owner) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '负责人必须是团队中的有效成员')
}

async function setBotSkills(tx: BotRunTransaction, row: BotRow, actorId: string, skillIds: string[]) {
  if (skillIds.length) {
    const validSkills = await tx
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.team_id, row.team_id), eq(skill.enabled, true), inArray(skill.id, skillIds)))
      .orderBy(asc(skill.id))
      .for('update')
    if (validSkills.length !== new Set(skillIds).size) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '仅可选择本团队已启用的技能')
    }
  }
  await tx.delete(botSkill).where(and(eq(botSkill.team_id, row.team_id), eq(botSkill.bot_id, row.id)))
  if (skillIds.length) {
    await tx.insert(botSkill).values(
      [...new Set(skillIds)].map((skillId) => ({
        team_id: row.team_id,
        bot_id: row.id,
        skill_id: skillId,
        configured_by: actorId,
      })),
    )
  }
}

function botReadQuery(db: BotRead, visibleTo?: string) {
  return db
    .select({
      record: bot,
      ownerName: authUser.name,
      connectionName: botModelConnection.name,
      connectionStatus: sql<string | null>`case
        when ${botModelConnection.auth_type} = 'api_key' and ${credential.id} is null then 'disabled'
        when ${botModelConnection.auth_type} = 'oauth' and ${botModelConnection.oauth_secret} is null then 'disabled'
        else ${botModelConnection.status} end`,
      hasModel: sql<boolean>`${botModelCatalog.id} is not null`,
      lastActiveAt: visibleTo
        ? sql<Date | null>`(
            select max(coalesce(${botRun.finished_at}, ${botRun.started_at})) from ${botRun}
            join ${botConversationMember} on ${botConversationMember.conversation_id} = ${botRun.conversation_id}
              and ${botConversationMember.team_id} = ${botRun.team_id}
              and ${botConversationMember.member_kind} = 'user' and ${botConversationMember.member_id} = ${visibleTo}
              and ${botConversationMember.removed_at} is null
            where ${botRun.bot_id} = ${bot.id} and ${botRun.team_id} = ${bot.team_id}
          )`.mapWith(botRun.updated_at)
        : sql<null>`null`,

      workerOnline: sql<boolean>`exists (
      select 1 from ${botModelCatalog}
      where ${botModelCatalog.reported_at} > clock_timestamp() - ${WORKER_ONLINE_WINDOW_SECONDS} * interval '1 second'
    )`,
    })
    .from(bot)
    .leftJoin(authUser, eq(authUser.id, bot.owner_user_id))
    .leftJoin(
      botModelConnection,
      and(eq(botModelConnection.id, bot.model_connection_id), eq(botModelConnection.team_id, bot.team_id)),
    )
    .leftJoin(
      credential,
      and(
        eq(credential.id, botModelConnection.credential_id),
        eq(credential.team_id, bot.team_id),
        eq(credential.kind, 'model_api_key'),
        eq(credential.status, 'active'),
        or(isNull(credential.expires_at), gt(credential.expires_at, sql`clock_timestamp()`)),
      ),
    )
    .leftJoin(
      botModelCatalog,
      and(
        eq(botModelCatalog.provider_id, botModelConnection.provider_id),
        eq(botModelCatalog.model_id, bot.model_id),
        sql`${botModelConnection.auth_type} = any(${botModelCatalog.auth_types})`,
      ),
    )
}

async function viewWithSkills(db: BotRead, row: BotViewRecord) {
  const skills = await db
    .select({ id: botSkill.skill_id })
    .from(botSkill)
    .where(and(eq(botSkill.team_id, row.record.team_id), eq(botSkill.bot_id, row.record.id)))
    .orderBy(asc(botSkill.skill_id))
    .limit(50)
  return toBotView(
    row,
    skills.map(({ id }) => id),
  )
}

async function addActivity(tx: BotRunTransaction, row: BotRow, userId: string, action: string) {
  await insertActivity(tx, {
    id: randomUUID(),
    teamId: row.team_id,
    projectId: null,
    entityType: 'bot',
    entityId: row.id,
    action,
    actorUserId: userId,
    changes: {
      configVersion: row.config_version,
      status: row.status,
      ownerUserId: row.owner_user_id,
      modelConnectionId: row.model_connection_id,
      modelId: row.model_id,
    },
  })
}

function throwMissingBot(): never {
  throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, 'Bot 不存在或不可见')
}

/**
 * 锁定团队范围内可接受新运行的 Bot，保证入队与同时进行的停用互斥。
 * @param tx 将创建会话消息或任务的事务。
 * @param teamId 该会话的所属团队。
 * @param botId 候选执行者。
 * @returns 团队范围内的 Bot 记录。
 * @throws Bot 不存在或不可运行时返回业务错误，并附可用性原因。
 */
export async function requireRunnableBot(tx: BotRunTransaction, teamId: string, botId: string) {
  const [locked] = await tx
    .select({ id: bot.id })
    .from(bot)
    .where(and(eq(bot.id, botId), eq(bot.team_id, teamId)))
    .for('update')
  if (!locked) throwMissingBot()
  const [row] = await botReadQuery(tx).where(and(eq(bot.id, botId), eq(bot.team_id, teamId)))
  if (!row) throwMissingBot()
  const reason = botAvailability(row)
  if (reason !== 'available') throw new ApiError(ERROR_CODES.BOT_UNAVAILABLE, '当前 Bot 无法开始运行', { reason })
  return row.record
}

/**
 * 找出当前团队候选中可运行的 Bot，供会话技能候选校验。
 * @param db 当前数据库连接。
 * @param teamId 当前团队。
 * @param ids 已通过成员关系限定的 Bot 标识。
 * @returns 可运行标识列表。
 */
export async function runnableBotIds(db: BotRead, teamId: string, ids: string[]) {
  if (ids.length === 0) return []
  const rows = await botReadQuery(db).where(and(eq(bot.team_id, teamId), inArray(bot.id, ids)))
  return rows.filter((row) => botAvailability(row) === 'available').map(({ record }) => record.id)
}

/**
 * 创建团队 Bot 管理服务。
 * @param db 平台数据库连接。
 * @returns 带团队、角色和配置版本校验的读写用例。
 */
export function createBotsService(db: Database) {
  async function requireVisible(actor: SessionUser, botId: string, roles?: TeamRole[]) {
    const [row] = await botReadQuery(db, actor.id).where(eq(bot.id, botId))
    if (!row) throwMissingBot()
    const [member] = await db
      .select({ role: teamMember.role })
      .from(teamMember)
      .where(
        and(
          eq(teamMember.team_id, row.record.team_id),
          eq(teamMember.user_id, actor.id),
          eq(teamMember.status, 'active'),
        ),
      )
    if (!member) throwMissingBot()
    if (roles && !roles.some((role) => member.role === role))
      throw new ApiError(ERROR_CODES.FORBIDDEN, '没有权限修改 Bot 配置')
    return row
  }

  async function getAfterWrite(tx: BotRunTransaction, id: string): Promise<BotView> {
    const [row] = await botReadQuery(tx).where(eq(bot.id, id))
    if (!row) throwMissingBot()
    return viewWithSkills(tx, row)
  }

  async function checkedUpdate(
    actor: SessionUser,
    id: string,
    configVersion: number,
    roles: TeamRole[],
    change: (tx: BotRunTransaction, previous: BotRow) => Promise<Partial<typeof bot.$inferInsert>>,
    after: (tx: BotRunTransaction, saved: BotRow) => Promise<void>,
  ) {
    const current = await requireVisible(actor, id, roles)
    try {
      return await db.transaction(async (tx) => {
        await requireTeamMember(tx, actor.id, current.record.team_id, roles)
        const [locked] = await tx
          .select()
          .from(bot)
          .where(and(eq(bot.id, id), eq(bot.team_id, current.record.team_id)))
          .for('update')
        if (!locked) throwMissingBot()
        if (locked.config_version !== configVersion)
          throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bot 配置已修改，请刷新后重试')
        const fields = await change(tx, locked)
        const [updated] = await tx
          .update(bot)
          .set({
            ...fields,
            config_version: sql`${bot.config_version} + 1`,
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(bot.id, id), eq(bot.team_id, locked.team_id), eq(bot.config_version, configVersion)))
          .returning()
        if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bot 配置已修改，请刷新后重试')
        await after(tx, updated)
        return getAfterWrite(tx, id)
      })
    } catch (error) {
      errorsForNameConflict(error)
    }
  }

  return {
    /** 按名称、负责人和游标分页读取团队 Bot，团队成员只读访问。 */
    async list(actor: SessionUser, teamId: string, filters: BotListFilters) {
      await requireTeamMember(db, actor.id, teamId)
      const query = filters.query?.trim().replace(/[\\%_]/gu, '\\$&')
      const rows = await botReadQuery(db, actor.id)
        .where(
          and(
            eq(bot.team_id, teamId),
            filters.ownerUserId ? eq(bot.owner_user_id, filters.ownerUserId) : undefined,
            filters.cursor ? gt(bot.id, filters.cursor) : undefined,
            query
              ? or(
                  ilike(bot.name, `%${query}%`),
                  ilike(bot.responsibility, `%${query}%`),
                  ilike(authUser.name, `%${query}%`),
                )
              : undefined,
          ),
        )
        .orderBy(asc(bot.id))
        .limit(PAGE_SIZE + 1)
      const visible = rows.slice(0, PAGE_SIZE)
      const skills = visible.length
        ? await db
            .select({ botId: botSkill.bot_id, id: botSkill.skill_id })
            .from(botSkill)
            .where(
              and(
                eq(botSkill.team_id, teamId),
                inArray(
                  botSkill.bot_id,
                  visible.map(({ record }) => record.id),
                ),
              ),
            )
            .orderBy(asc(botSkill.skill_id))
        : []
      const items = visible.map((row) =>
        toBotView(
          row,
          skills.filter(({ botId }) => botId === row.record.id).map(({ id }) => id),
        ),
      )
      return { items, nextCursor: rows.length > PAGE_SIZE ? (items.at(-1)?.id ?? null) : null }
    },
    /** 读取 Bot 的配置和可用性，跨团队调用按不存在处理。 */
    async get(actor: SessionUser, id: string) {
      return viewWithSkills(db, await requireVisible(actor, id))
    },
    /** 在团队内创建 Bot，校验负责人、技能及名称唯一性。 */
    async create(actor: SessionUser, teamId: string, input: CreateBotInput) {
      const fields = nameAndResponsibility(input)
      try {
        return await db.transaction(async (tx) => {
          await requireTeamMember(tx, actor.id, teamId, BOT_EDIT_ROLES)
          await requireOwner(tx, teamId, input.ownerUserId)
          const [row] = await tx
            .insert(bot)
            .values({
              ...fields,
              team_id: teamId,
              owner_user_id: input.ownerUserId,
              created_by: actor.id,
              avatar_key: input.avatarKey ?? null,
              instructions: input.instructions?.trim() ?? '',
            })
            .returning()
          if (!row) throw new Error('未能创建 Bot')
          if (input.skillIds?.length) await setBotSkills(tx, row, actor.id, input.skillIds)
          await addActivity(tx, row, actor.id, 'bot_created')
          return getAfterWrite(tx, row.id)
        })
      } catch (error) {
        errorsForNameConflict(error)
      }
    },
    /** 基于配置版本更新 Bot 的常规设置。 */
    async update(actor: SessionUser, id: string, input: UpdateBotInput) {
      const fields = nameAndResponsibility(input)
      return checkedUpdate(
        actor,
        id,
        input.configVersion,
        BOT_EDIT_ROLES,
        async (tx, previous) => {
          await requireOwner(tx, previous.team_id, input.ownerUserId)
          return {
            ...fields,
            owner_user_id: input.ownerUserId,
            avatar_key: input.avatarKey === undefined ? previous.avatar_key : input.avatarKey,
            instructions: input.instructions === undefined ? previous.instructions : input.instructions.trim(),
          }
        },
        async (tx, row) => {
          if (input.skillIds !== undefined) await setBotSkills(tx, row, actor.id, input.skillIds)
          await addActivity(tx, row, actor.id, 'bot_updated')
        },
      )
    },
    /** 团队管理员为 Bot 绑定可用连接和目录中的指定模型。 */
    async bind(actor: SessionUser, id: string, input: BindBotModelInput) {
      return checkedUpdate(
        actor,
        id,
        input.configVersion,
        ['admin'],
        async (tx, previous) => {
          const [connection] = await tx
            .select()
            .from(botModelConnection)
            .where(and(eq(botModelConnection.id, input.connectionId), eq(botModelConnection.team_id, previous.team_id)))
            .for('update')
          if (!connection || connection.status !== 'active') {
            throw new ApiError(ERROR_CODES.BOT_MODEL_CONNECTION_UNAVAILABLE, '模型连接当前不可用')
          }
          const [model] = await tx
            .select({ id: botModelCatalog.id })
            .from(botModelCatalog)
            .where(
              and(
                eq(botModelCatalog.provider_id, connection.provider_id),
                eq(botModelCatalog.model_id, input.modelId),
                sql`${connection.auth_type} = any(${botModelCatalog.auth_types})`,
              ),
            )
          if (!model) throw new ApiError(ERROR_CODES.BOT_MODEL_NOT_IN_CATALOG, '模型目录中没有所选模型')
          return { model_connection_id: connection.id, model_id: input.modelId }
        },
        (tx, row) => addActivity(tx, row, actor.id, 'bot_model_bound'),
      )
    },
    /** 更改开关，停用时停止运行并将未完成任务标记为受阻。 */
    async setEnabled(actor: SessionUser, id: string, configVersion: number, enabled: boolean) {
      const status = enabled ? 'enabled' : 'disabled'
      return checkedUpdate(
        actor,
        id,
        configVersion,
        BOT_EDIT_ROLES,
        async () => ({ status }),
        async (tx, row) => {
          if (!enabled) {
            await stopRunsForBot(tx, row.team_id, row.id)
            await tx
              .update(botTask)
              .set({
                status: 'waiting',
                wait_reason: 'executor_unavailable',
                blocked: true,
                version: sql`${botTask.version} + 1`,
                updated_at: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(botTask.team_id, row.team_id),
                  eq(botTask.executor_bot_id, row.id),
                  inArray(botTask.status, ['pending', 'in_progress', 'waiting']),
                ),
              )
          }
          await addActivity(tx, row, actor.id, enabled ? 'bot_enabled' : 'bot_disabled')
        },
      )
    },
    /** 分页返回该团队成员可访问的会话运行。 */
    async runs(actor: SessionUser, id: string, cursor?: string) {
      const { record } = await requireVisible(actor, id)
      const rows = await db
        .select({ run: botRun })
        .from(botRun)
        .innerJoin(
          botConversationMember,
          and(
            eq(botConversationMember.team_id, botRun.team_id),
            eq(botConversationMember.conversation_id, botRun.conversation_id),
            eq(botConversationMember.member_kind, 'user'),
            eq(botConversationMember.member_id, actor.id),
            isNull(botConversationMember.removed_at),
          ),
        )
        .where(
          and(eq(botRun.team_id, record.team_id), eq(botRun.bot_id, id), cursor ? gt(botRun.id, cursor) : undefined),
        )
        .orderBy(asc(botRun.id))
        .limit(PAGE_SIZE + 1)
      const items = rows.slice(0, PAGE_SIZE).map(({ run }) => toBotRunSummary(run))
      return { items, nextCursor: rows.length > PAGE_SIZE ? (items.at(-1)?.id ?? null) : null }
    },
  }
}

export type BotsService = ReturnType<typeof createBotsService>
