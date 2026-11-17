import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { insertActivity } from '../collaboration/collaboration.repository.ts'
import { botTask } from '../tasks/bot-tasks.tables.ts'
import { stopRunsForBot, type BotRunTransaction } from './bots.run-queue.repository.ts'
import { bot, botLoginSession, botModelConnection } from './bots.tables.ts'

/**
 * 停止某条连接关联的执行并标记由该连接受阻的任务。
 * @param tx 连接状态更新所在事务。
 * @param teamId 负责该连接的团队。
 * @param connectionId 已不可用的连接。
 * @returns 同一事务内更新运行及任务。
 */
export async function suspendConnectionWork(tx: BotRunTransaction, teamId: string, connectionId: string) {
  const bots = await tx
    .select({ id: bot.id })
    .from(bot)
    .where(and(eq(bot.team_id, teamId), eq(bot.model_connection_id, connectionId)))
    .orderBy(asc(bot.id))
  if (!bots.length) return
  for (const { id } of bots) await stopRunsForBot(tx, teamId, id)
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
        eq(botTask.team_id, teamId),
        inArray(
          botTask.executor_bot_id,
          bots.map(({ id }) => id),
        ),
        inArray(botTask.status, ['pending', 'in_progress', 'waiting']),
      ),
    )
}

/**
 * 同步停用刚失去管理员角色的成员所登录的订阅连接。
 * @param tx 更新团队成员的事务。
 * @param teamId 当前团队，其他团队的授权不受影响。
 * @param loginUserId 不再有团队管理权限的成员。
 * @param actorId 执行成员变更的管理员。
 * @returns 连接、交互和在途运行已在同一事务中关闭。
 */
export async function disableOAuthConnectionsForUser(
  tx: BotRunTransaction,
  teamId: string,
  loginUserId: string,
  actorId: string,
) {
  const rows = await tx
    .update(botModelConnection)
    .set({
      status: 'disabled',
      disabled_reason: 'login_user_demoted',
      version: sql`${botModelConnection.version} + 1`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(botModelConnection.team_id, teamId),
        eq(botModelConnection.login_user_id, loginUserId),
        eq(botModelConnection.auth_type, 'oauth'),
      ),
    )
    .returning({ id: botModelConnection.id })
  if (!rows.length) return
  await tx
    .update(botLoginSession)
    .set({
      status: 'failed',
      answer_secret: null,
      prompt: null,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(botLoginSession.team_id, teamId),
        inArray(
          botLoginSession.connection_id,
          rows.map(({ id }) => id),
        ),
        inArray(botLoginSession.status, ['pending', 'waiting_user']),
      ),
    )
  for (const { id } of rows.sort((left, right) => left.id.localeCompare(right.id))) {
    await suspendConnectionWork(tx, teamId, id)
    await insertActivity(tx, {
      id: randomUUID(),
      teamId,
      entityId: id,
      projectId: null,
      entityType: 'bot_model_connection',
      action: 'bot_model_connection_disabled',
      actorUserId: actorId,
      changes: { reason: 'login_user_demoted' },
    })
  }
}
