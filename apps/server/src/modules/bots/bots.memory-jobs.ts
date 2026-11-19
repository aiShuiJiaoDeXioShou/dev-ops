import { and, asc, eq, gte, inArray, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../../platform/database/client.ts'
import { botMemoryCursor } from './bots.platform.tables.ts'
import { bot, botRun } from './bots.tables.ts'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Result = 'applied' | 'no_change' | 'failed' | 'skipped_budget' | 'skipped_model'
const JOB_BATCH_SIZE = 20

/**
 * 为当前空闲且今天尚未整理的 Bot 排队。计划任务与手动入口共享同一个去重锁。
 * @param db 执行进程或 HTTP 服务数据库。
 * @param filter 手动触发限定的团队、Bot 与操作者。
 * @returns 已排入的运行标识；没有空闲候选时返回空数组。
 */
export async function enqueueBotMemoryJobs(db: Database, filter?: { teamId: string; botId: string; actorId: string }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(164836, 10)`)
    const active = alias(botRun, 'active_bot_run')
    const today = alias(botRun, 'today_memory_run')
    const midnight = sql`date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC'`
    const eligible = await tx
      .select({ teamId: bot.team_id, botId: bot.id, owner: bot.owner_user_id })
      .from(bot)
      .where(
        and(
          eq(bot.status, 'enabled'),
          filter ? and(eq(bot.team_id, filter.teamId), eq(bot.id, filter.botId)) : undefined,
          notExists(
            tx
              .select({ id: active.id })
              .from(active)
              .where(
                and(
                  eq(active.team_id, bot.team_id),
                  eq(active.bot_id, bot.id),
                  inArray(active.status, ['queued', 'running']),
                ),
              ),
          ),
          notExists(
            tx
              .select({ id: today.id })
              .from(today)
              .where(
                and(
                  eq(today.team_id, bot.team_id),
                  eq(today.bot_id, bot.id),
                  eq(today.kind, 'memory_consolidation'),
                  gte(today.created_at, midnight),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(bot.id))
      .limit(filter ? 1 : JOB_BATCH_SIZE)
    if (!eligible.length) return []
    return tx
      .insert(botRun)
      .values(
        eligible.map((row) => ({
          team_id: row.teamId,
          bot_id: row.botId,
          trigger_user_id: filter?.actorId ?? row.owner,
          kind: 'memory_consolidation',
          input_version: 0,
        })),
      )
      .returning({ id: botRun.id })
  })
}

/**
 * 记录记忆整理结果，只有确认完整写回时才推进处理范围。
 * @param tx 运行收口事务。
 * @param run 本次整理的标识及所属范围。
 * @param result 整理结果。
 * @param through 已成功处理的数据截止时间。
 * @returns 保存后完成。
 */
export async function recordBotMemoryJob(
  tx: Transaction,
  run: { id: string; team_id: string; bot_id: string },
  result: Result,
  through?: Date,
) {
  const common = { last_run_id: run.id, last_result: result, updated_at: sql`clock_timestamp()` }
  await tx
    .insert(botMemoryCursor)
    .values({
      team_id: run.team_id,
      bot_id: run.bot_id,
      processed_until: through ?? new Date(0),
      ...common,
    })
    .onConflictDoUpdate({
      target: botMemoryCursor.bot_id,
      set: {
        ...common,
        ...(through
          ? {
              processed_until: sql`greatest(${botMemoryCursor.processed_until}, ${through.toISOString()}::timestamptz)`,
            }
          : {}),
      },
    })
}
