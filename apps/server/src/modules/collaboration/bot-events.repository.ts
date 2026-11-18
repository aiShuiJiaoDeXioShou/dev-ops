import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { botEvent } from './bot-conversations.tables.ts'

type EventTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type EventInsert = Pick<typeof botEvent.$inferInsert, 'kind' | 'payload' | 'run_sequence' | 'created_at'>
type EventScope = { teamId: string; conversationId: string; runId: string }

/**
 * 按会话分配连续的事件游标，跳过已经提交的运行事件。
 * @param tx 与消息或运行状态共用的事务。
 * @param scope 团队、会话和所属运行。
 * @param events 待追加的事件，运行内序号和已知的发生时间由调用方提供。
 * @returns 写入完成；失败时由调用者回滚事务。
 */
export async function appendBotEvents(tx: EventTransaction, scope: EventScope, events: readonly EventInsert[]) {
  if (events.length === 0) return
  // 增量写入不抢占消息行锁。相同会话的游标分配由独立事务锁串行。
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`bot-events:${scope.conversationId}`}, 0))`)
  const [latest] = await tx
    .select({ sequence: botEvent.sequence })
    .from(botEvent)
    .where(and(eq(botEvent.team_id, scope.teamId), eq(botEvent.conversation_id, scope.conversationId)))
    .orderBy(desc(botEvent.sequence))
    .limit(1)
  let sequence = latest?.sequence ?? 0n
  await tx
    .insert(botEvent)
    .values(
      events.map((event) => ({
        ...event,
        team_id: scope.teamId,
        conversation_id: scope.conversationId,
        run_id: scope.runId,
        sequence: ++sequence,
      })),
    )
    .onConflictDoNothing({ target: [botEvent.run_id, botEvent.run_sequence] })
}
