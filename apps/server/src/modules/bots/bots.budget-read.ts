import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { botUsageDaily, teamBotBudget } from './bots.platform.tables.ts'

/**
 * 用 PostgreSQL 精确比较团队当月已知费用与预算，金额为空表示无限额。
 * @param db 领取运行的数据库或事务。
 * @param teamId 运行所属团队。
 * @returns 到达当前 UTC 自然月上限时为 true。
 */
export async function isBotBudgetExhausted(db: Pick<Database, 'select'>, teamId: string): Promise<boolean> {
  const month = sql`date_trunc('month', clock_timestamp() at time zone 'UTC')::date`
  const known = db
    .select({ total: sql`coalesce(sum(${botUsageDaily.cost_usd}), 0)` })
    .from(botUsageDaily)
    .where(
      and(
        eq(botUsageDaily.team_id, teamId),
        gte(botUsageDaily.usage_date, month),
        lt(botUsageDaily.usage_date, sql`${month} + interval '1 month'`),
      ),
    )
  const [budget] = await db
    .select({ exhausted: sql<boolean>`(${known}) >= ${teamBotBudget.monthly_limit_usd}` })
    .from(teamBotBudget)
    .where(eq(teamBotBudget.team_id, teamId))
  return budget?.exhausted === true
}
