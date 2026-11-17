import type { BotRunRecord } from '../bots/bots.run-queue.repository.ts'
import type { BotTaskView, TaskRunView } from './bot-tasks.schema.ts'
import type { botTask } from './bot-tasks.tables.ts'

/** 将任务持久化记录转换为外部视图，并校验数据库内的状态字段。 */
export function botTaskView(row: typeof botTask.$inferSelect): BotTaskView {
  const status = row.status
  const reason = row.wait_reason
  if (
    status !== 'pending' &&
    status !== 'in_progress' &&
    status !== 'waiting' &&
    status !== 'awaiting_review' &&
    status !== 'completed' &&
    status !== 'cancelled'
  )
    throw new Error('数据库中的 Bot 任务状态不合法')
  if (
    reason !== null &&
    reason !== 'needs_input' &&
    reason !== 'run_failed' &&
    reason !== 'executor_unavailable' &&
    reason !== 'stopped'
  )
    throw new Error('数据库中的 Bot 任务等待原因不合法')
  return {
    id: row.id,
    teamId: row.team_id,
    conversationId: row.conversation_id,
    title: row.title,
    acceptanceCriteria: row.acceptance_criteria,
    businessOwnerId: row.business_owner_id,
    executorBotId: row.executor_bot_id,
    status,
    waitReason: reason,
    blocked: row.blocked,
    version: row.version,
    inputVersion: row.input_version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function snapshotString(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value: unknown = Reflect.get(snapshot, key)
  return typeof value === 'string' ? value : null
}

/** 读取运行中可公开的配置快照字段与状态，凭据和内部失败原因留在运行内部。 */
export function taskRunView(row: BotRunRecord): TaskRunView {
  const status = row.status
  if (
    status !== 'queued' &&
    status !== 'running' &&
    status !== 'succeeded' &&
    status !== 'failed' &&
    status !== 'stopped'
  ) {
    throw new Error('数据库中的 Bot 运行状态不合法')
  }
  return {
    id: row.id,
    botId: row.bot_id,
    triggerUserId: row.trigger_user_id,
    inputVersion: row.input_version,
    status,
    stopRequested: row.stop_requested,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    modelConnectionId: snapshotString(row.config_snapshot, 'modelConnectionId'),
    modelId: snapshotString(row.config_snapshot, 'modelId'),
    failureKind: row.failure_kind,
    failureMessage: row.failure_message,
    turns: row.turns,
    usage: row.usage,
  }
}
