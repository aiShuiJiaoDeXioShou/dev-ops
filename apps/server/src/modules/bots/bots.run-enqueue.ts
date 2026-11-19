import { sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { appendBotEvents } from '../collaboration/bot-events.repository.ts'
import { botRun } from './bots.tables.ts'

export type BotRunTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type BotRunRecord = typeof botRun.$inferSelect

/**
 * 新增已由业务用例校验的运行，并在同一事务发布排队状态。
 * @param tx 创建消息或任务时使用的事务。
 * @param input 所属团队、会话、Bot、触发人和可选的任务或消息。
 * @returns 排队记录；创建失败时抛错。
 */
export async function enqueueBotRun(
  tx: BotRunTransaction,
  input: Pick<
    typeof botRun.$inferInsert,
    | 'team_id'
    | 'conversation_id'
    | 'task_id'
    | 'bot_id'
    | 'trigger_user_id'
    | 'trigger_message_id'
    | 'input_version'
    | 'kind'
    | 'relay_id'
    | 'relay_role'
    | 'hop'
  >,
): Promise<BotRunRecord> {
  const [run] = await tx
    .insert(botRun)
    .values({
      ...input,
      kind: input.kind ?? (input.task_id ? 'task' : 'reply'),
      created_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    })
    .returning()
  if (!run) throw new Error('未能创建 Bot 运行')
  await writeRunState(tx, run)
  return run
}

/**
 * 为会话发布运行的当前状态，和调用者的运行变更一起提交。
 * @param tx 同时更新运行的事务。
 * @param run 已持久化的运行。
 * @param actorId 发起状态变化的成员，可省略。
 * @returns 事件写入完成；后台整理运行没有会话时直接返回。
 */
export async function writeRunState(tx: BotRunTransaction, run: BotRunRecord, actorId?: string) {
  if (!run.conversation_id) return
  await appendBotEvents(tx, { teamId: run.team_id, conversationId: run.conversation_id, runId: run.id }, [
    {
      kind: 'run_status',
      payload: {
        runId: run.id,
        botId: run.bot_id,
        status: run.status,
        failureKind: run.failure_kind,
        failureMessage: run.failure_message,
        stopRequested: run.stop_requested,
        ...(actorId ? { actorId } : {}),
      },
    },
  ])
}
