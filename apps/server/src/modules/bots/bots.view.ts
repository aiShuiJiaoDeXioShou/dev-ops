import { skillVersionsOf } from './bots.skills.ts'
import type { BotRunSummary, BotView } from './bots.schema.ts'
import type { bot, botRun } from './bots.tables.ts'

export type BotViewRecord = {
  record: typeof bot.$inferSelect
  ownerName: string | null
  connectionName: string | null
  connectionStatus: string | null
  hasModel: boolean
  workerOnline: boolean
  lastActiveAt: Date | null
}

/**
 * 综合 Bot 开关、模型绑定和执行进程状态，返回当前首要不可用原因。
 * @param row Bot 及模型目录、链接和执行能力投影。
 * @returns 用于接口与界面展示的可用性。
 */
export function botAvailability(row: BotViewRecord): BotView['availability'] {
  if (row.record.status === 'disabled') return 'disabled'
  if (!row.record.model_connection_id || !row.record.model_id) return 'model_unbound'
  if (row.connectionStatus !== 'active' || !row.hasModel) return 'model_unavailable'
  if (!row.workerOnline) return 'worker_offline'
  return 'available'
}

/**
 * 生成 Bot 的安全响应，不暴露连接凭据。
 * @param row Bot 配置和安全关联字段。
 * @param skillIds 已配置的技能标识。
 * @returns Bot 响应；数据库状态不合法时抛错。
 */
export function toBotView(row: BotViewRecord, skillIds: string[]): BotView {
  const { record } = row
  if (record.status !== 'enabled' && record.status !== 'disabled') throw new Error('数据库中的 Bot 状态不合法')
  if (record.access_mode !== 'sandbox' && record.access_mode !== 'full')
    throw new Error('数据库中的 Bot 访问模式不合法')
  return {
    id: record.id,
    teamId: record.team_id,
    name: record.name,
    responsibility: record.responsibility,
    instructions: record.instructions,
    avatarKey: record.avatar_key,
    ownerUserId: record.owner_user_id,
    ownerName: row.ownerName,
    status: record.status,
    availability: botAvailability(row),
    configVersion: record.config_version,
    modelConnectionId: record.model_connection_id,
    connectionName: row.connectionName,
    modelId: record.model_id,
    accessMode: record.access_mode,
    updatedAt: record.updated_at.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    skillIds,
  }
}

/**
 * 将运行记录转换为会话成员可查看的运行摘要。
 * @param row Bot 运行记录。
 * @returns 不含提示词、连接凭据和工具输入的摘要。
 * @throws 数据库中的运行状态不合法时抛错。
 */
export function toBotRunSummary(row: typeof botRun.$inferSelect): BotRunSummary {
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
  if (!row.conversation_id) throw new Error('会话运行缺少会话标识')
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status,
    skillVersions: skillVersionsOf(row.config_snapshot),
    failureKind: row.failure_kind,
    failureMessage: row.failure_message,
    turns: row.turns,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  }
}
