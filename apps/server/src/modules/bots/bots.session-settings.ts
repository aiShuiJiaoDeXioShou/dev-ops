import { and, eq, inArray, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'
import { botEvent } from '../collaboration/bot-conversations.tables.ts'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { botConversationBotSetting } from '../collaboration/bot-relay.tables.ts'
import type { BotRunTransaction } from './bots.run-queue.repository.ts'
import { bot, botModelCatalog, botModelConnection } from './bots.tables.ts'

export const botThinkingLevel = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
])

export const effectiveBotThinkingLevel = Type.Union([botThinkingLevel, Type.Literal('max')])

export const botSessionSettingBody = Type.Object(
  {
    modelId: Type.Union([Type.String({ minLength: 1, maxLength: 250 }), Type.Null()]),
    thinkingLevel: Type.Union([botThinkingLevel, Type.Null()]),
  },
  { additionalProperties: false },
)

type SettingBody = Static<typeof botSessionSettingBody>

function compatibleModel(modelId: string | typeof botConversationBotSetting.model_id) {
  return and(
    eq(botModelConnection.id, bot.model_connection_id),
    eq(botModelConnection.team_id, bot.team_id),
    eq(botModelConnection.status, 'active'),
    eq(botModelCatalog.provider_id, botModelConnection.provider_id),
    eq(botModelCatalog.model_id, modelId),
    sql`${botModelConnection.auth_type} = any(${botModelCatalog.auth_types})`,
  )
}

/**
 * 读取会话中每个 Bot 的配置覆盖，并判断模型是否仍属于当前连接。
 * @param db 平台数据库或事务。
 * @param room 已校验会话及团队范围。
 * @param ids 会话中有效 Bot 成员。
 * @returns 当前覆盖配置，未选择者使用 null。
 */
export async function readBotSessionSettings(
  db: Pick<Database, 'select'>,
  room: { id: string; team_id: string },
  ids: string[],
) {
  if (!ids.length) return []
  const effective = db
    .select({ level: sql<string>`${botEvent.payload}->>'effective'` })
    .from(botEvent)
    .where(
      and(
        eq(botEvent.team_id, room.team_id),
        eq(botEvent.conversation_id, room.id),
        sql`${botEvent.payload}->>'botId' = ${bot.id}::text`,
        sql`${botEvent.payload}->>'state' = 'model_selected'`,
        sql`${botEvent.payload}->>'requested' is not distinct from ${botConversationBotSetting.thinking_level}`,
        sql`${botEvent.payload}->>'modelId' = coalesce(${botConversationBotSetting.model_id}, ${bot.model_id})`,
      ),
    )
    .orderBy(sql`${botEvent.sequence} desc`)
    .limit(1)
  const rows = await db
    .select({
      botId: bot.id,
      modelId: botConversationBotSetting.model_id,
      thinkingLevel: botConversationBotSetting.thinking_level,
      effectiveThinkingLevel: sql<unknown>`(${effective})`,
      isOverrideValid: sql<boolean>`${botConversationBotSetting.model_id} is null or exists (${db
        .select({ id: botModelCatalog.id })
        .from(botModelCatalog)
        .innerJoin(botModelConnection, compatibleModel(botConversationBotSetting.model_id))})`,
    })
    .from(bot)
    .leftJoin(
      botConversationBotSetting,
      and(
        eq(botConversationBotSetting.team_id, room.team_id),
        eq(botConversationBotSetting.conversation_id, room.id),
        eq(botConversationBotSetting.bot_id, bot.id),
      ),
    )
    .where(and(eq(bot.team_id, room.team_id), inArray(bot.id, ids)))
  return rows.map((row) => ({
    ...row,
    thinkingLevel: Check(botThinkingLevel, row.thinkingLevel) ? row.thinkingLevel : null,
    effectiveThinkingLevel:
      row.isOverrideValid && Check(effectiveBotThinkingLevel, row.effectiveThinkingLevel)
        ? row.effectiveThinkingLevel
        : null,
  }))
}

/**
 * 保存某个会话内的模型与思考等级覆盖，授予权限的连接由 Bot 全局配置决定。
 * @param tx 已校验会话写权限的事务。
 * @param scope 团队、会话、Bot、修改者标识。
 * @param input 模型覆盖与思考等级，空值表示沿用。
 * @returns 已保存的覆盖；所选模型不属于当前连接时抛出业务错误。
 */
export async function saveBotSessionSetting(
  tx: BotRunTransaction,
  scope: { teamId: string; conversationId: string; botId: string; actorId: string },
  input: SettingBody,
) {
  const [record] = await tx
    .select({ id: bot.id })
    .from(bot)
    .where(and(eq(bot.id, scope.botId), eq(bot.team_id, scope.teamId)))
    .for('update')
  if (!record) throw new ApiError(ERROR_CODES.BOT_NOT_FOUND, '智能体不在当前团队')
  if (input.modelId) {
    const [model] = await tx
      .select({ id: botModelCatalog.id })
      .from(bot)
      .innerJoin(
        botModelConnection,
        and(eq(botModelConnection.team_id, bot.team_id), eq(botModelConnection.id, bot.model_connection_id)),
      )
      .innerJoin(botModelCatalog, compatibleModel(input.modelId))
      .where(and(eq(bot.id, scope.botId), eq(bot.team_id, scope.teamId)))
    if (!model) throw new ApiError(ERROR_CODES.BOT_MODEL_OVERRIDE_INVALID, '所选模型不在智能体现有连接的目录内')
  }
  const changes = {
    model_id: input.modelId,
    thinking_level: input.thinkingLevel,
    updated_by: scope.actorId,
    updated_at: new Date(),
  }
  await tx
    .insert(botConversationBotSetting)
    .values({
      ...changes,
      team_id: scope.teamId,
      conversation_id: scope.conversationId,
      bot_id: scope.botId,
    })
    .onConflictDoUpdate({
      target: [botConversationBotSetting.conversation_id, botConversationBotSetting.bot_id],
      set: changes,
    })
  return { botId: scope.botId, ...input }
}
