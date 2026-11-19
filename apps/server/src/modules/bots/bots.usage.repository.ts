import { sql } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { botUsageDaily } from './bots.platform.tables.ts'

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const usageSchema = Type.Object({
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  costUsd: Type.Number({ minimum: 0 }),
  costKnown: Type.Optional(Type.Boolean()),
})

/**
 * 在终态事务内归集本次运行的用量。没有发生模型请求的运行不改变统计。
 * @param tx 更新同一运行终态的事务。
 * @param run 已关闭的运行，包含所属团队和执行 Bot。
 * @param usage 最终运行用量。
 * @returns 归集完成；重复终态请求由调用者的租约条件阻止。
 */
export async function addBotDailyUsage(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  run: { team_id: string; bot_id: string },
  usage: unknown,
): Promise<void> {
  if (!Check(usageSchema, usage)) return
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd } = usage
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0 && costUsd === 0) return
  await tx
    .insert(botUsageDaily)
    .values({
      team_id: run.team_id,
      bot_id: run.bot_id,
      usage_date: sql`(clock_timestamp() at time zone 'UTC')::date`,
      input_tokens: BigInt(inputTokens),
      output_tokens: BigInt(outputTokens),
      cache_read_tokens: BigInt(cacheReadTokens),
      cache_write_tokens: BigInt(cacheWriteTokens),
      cost_usd: costUsd.toFixed(6),
      unknown_cost_runs: Number(usage.costKnown === false),
    })
    .onConflictDoUpdate({
      target: [botUsageDaily.team_id, botUsageDaily.bot_id, botUsageDaily.usage_date],
      set: {
        input_tokens: sql`${botUsageDaily.input_tokens} + excluded.input_tokens`,
        output_tokens: sql`${botUsageDaily.output_tokens} + excluded.output_tokens`,
        cache_read_tokens: sql`${botUsageDaily.cache_read_tokens} + excluded.cache_read_tokens`,
        cache_write_tokens: sql`${botUsageDaily.cache_write_tokens} + excluded.cache_write_tokens`,
        cost_usd: sql`${botUsageDaily.cost_usd} + excluded.cost_usd`,
        unknown_cost_runs: sql`${botUsageDaily.unknown_cost_runs} + excluded.unknown_cost_runs`,
        updated_at: sql`clock_timestamp()`,
      },
    })
}
