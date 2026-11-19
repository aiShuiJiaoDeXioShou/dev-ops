import { and, asc, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { Type } from 'typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { Database } from '../../platform/database/client.ts'
import { apiResponseSchema, success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { requireTeamMember } from '../identity/identity.session.ts'
import { botUsageDaily, teamBotBudget } from './bots.platform.tables.ts'
import { bot } from './bots.tables.ts'

const id = Type.String({ pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' })
const teamParams = Type.Object({ teamId: id })
const period = Type.String({ pattern: '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' })
const decimal = Type.String({ pattern: '^(0|[1-9][0-9]{0,7})(\\.[0-9]{1,4})?$' })
const budgetBody = Type.Object({ monthlyLimitUsd: Type.Union([decimal, Type.Null()]) }, { additionalProperties: false })
const budgetResponse = apiResponseSchema(budgetBody)
const counts = {
  inputTokens: Type.String(),
  outputTokens: Type.String(),
  cacheReadTokens: Type.String(),
  cacheWriteTokens: Type.String(),
  costUsd: Type.String(),
  unknownCostRuns: Type.Integer({ minimum: 0 }),
  costKnown: Type.Boolean(),
}
const usage = Type.Object({
  month: period,
  monthlyLimitUsd: Type.Union([Type.String(), Type.Null()]),
  total: Type.Object(counts),
  byBot: Type.Array(Type.Object({ botId: id, name: Type.String(), ...counts })),
  byDay: Type.Array(Type.Object({ date: Type.String(), ...counts })),
  nextBotCursor: Type.Union([id, Type.Null()]),
})
const PAGE_SIZE = 100
const sums = {
  inputTokens: sql<string>`coalesce(sum(${botUsageDaily.input_tokens}), 0)::text`,
  outputTokens: sql<string>`coalesce(sum(${botUsageDaily.output_tokens}), 0)::text`,
  cacheReadTokens: sql<string>`coalesce(sum(${botUsageDaily.cache_read_tokens}), 0)::text`,
  cacheWriteTokens: sql<string>`coalesce(sum(${botUsageDaily.cache_write_tokens}), 0)::text`,
  costUsd: sql<string>`coalesce(sum(${botUsageDaily.cost_usd}), 0)::text`,
  unknownCostRuns: sql<number>`coalesce(sum(${botUsageDaily.unknown_cost_runs}), 0)`.mapWith(Number),
  costKnown: sql<boolean>`coalesce(sum(${botUsageDaily.unknown_cost_runs}), 0) = 0`,
}

/**
 * 注册月度 Bot 用量读取和管理员预算设置。
 * @param app HTTP 应用。
 * @param options 查询用数据库。
 * @returns 注册完成；费用用十进制字符串传输，未知费用单独计数。
 */
export const botUsageRoutes: FastifyPluginAsyncTypebox<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/teams/:teamId/bot-usage',
    {
      schema: {
        summary: '查看团队 Bot 月度用量',
        params: teamParams,
        querystring: Type.Object({
          month: Type.Optional(period),
          botId: Type.Optional(id),
          botCursor: Type.Optional(id),
        }),
        response: { 200: apiResponseSchema(usage) },
      },
    },
    async (request) => {
      const { teamId } = request.params
      const { botCursor, botId } = request.query
      await requireTeamMember(db, (await requireActor(request)).id, teamId)
      const month = request.query.month ?? new Date().toISOString().slice(0, 7)
      const start = `${month}-01`
      const scope = and(
        eq(botUsageDaily.team_id, teamId),
        gte(botUsageDaily.usage_date, start),
        lt(botUsageDaily.usage_date, sql`${start}::date + interval '1 month'`),
      )
      const [[budget], [total], bots, days] = await Promise.all([
        db
          .select({ limit: teamBotBudget.monthly_limit_usd })
          .from(teamBotBudget)
          .where(eq(teamBotBudget.team_id, teamId)),
        db.select(sums).from(botUsageDaily).where(scope),
        db
          .select({ botId: botUsageDaily.bot_id, name: sql<string>`coalesce(${bot.name}, '已移除的智能体')`, ...sums })
          .from(botUsageDaily)
          .leftJoin(bot, and(eq(bot.team_id, teamId), eq(bot.id, botUsageDaily.bot_id)))
          .where(and(scope, botCursor ? gt(botUsageDaily.bot_id, botCursor) : undefined))
          .groupBy(botUsageDaily.bot_id, bot.name)
          .orderBy(asc(botUsageDaily.bot_id))
          .limit(PAGE_SIZE + 1),
        db
          .select({ date: botUsageDaily.usage_date, ...sums })
          .from(botUsageDaily)
          .where(and(scope, botId ? eq(botUsageDaily.bot_id, botId) : undefined))
          .groupBy(botUsageDaily.usage_date)
          .orderBy(asc(botUsageDaily.usage_date)),
      ])
      if (!total) throw new Error('无法读取 Bot 用量统计')
      const byBot = bots.slice(0, PAGE_SIZE)
      return success(
        {
          month,
          monthlyLimitUsd: budget?.limit ?? null,
          total,
          byBot,
          byDay: days,
          nextBotCursor: bots.length > PAGE_SIZE ? (byBot.at(-1)?.botId ?? null) : null,
        },
        request.id,
      )
    },
  )
  app.post(
    '/teams/:teamId/bot-budget',
    {
      schema: {
        summary: '设置团队 Bot 月度费用预算',
        params: teamParams,
        body: budgetBody,
        response: { 200: budgetResponse },
      },
    },
    async (request) => {
      const { teamId } = request.params
      const actor = await requireActor(request)
      await db.transaction(async (tx) => {
        await requireTeamMember(tx, actor.id, teamId, ['admin'])
        const changes = {
          monthly_limit_usd: request.body.monthlyLimitUsd,
          updated_at: new Date(),
          updated_by: actor.id,
        }
        await tx
          .insert(teamBotBudget)
          .values({ team_id: teamId, ...changes })
          .onConflictDoUpdate({ target: teamBotBudget.team_id, set: changes })
      })
      return success(request.body, request.id)
    },
  )
}
