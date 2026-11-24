import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { authUser, teamMember } from '../identity/identity.tables.ts'
import type { BotActor } from '../identity/identity.bot-delegation.ts'
import { botConversationMember } from '../collaboration/bot-conversations.tables.ts'
import { bot, botRun, botRunToken } from './bots.tables.ts'
import { lockBotRunLease, type BotRunLease } from './bots.run-queue.repository.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * 签发当前租约的运行凭据，只保存哈希。
 * @param db 运行数据库。
 * @param lease 已领取的运行与租约代次。
 * @returns 仅本次返回的令牌明文。
 * @throws 租约失效、停止或数据库写入失败时抛错。
 */
export async function issueBotRunToken(db: Database, lease: BotRunLease): Promise<string> {
  return db.transaction(async (tx) => {
    const run = await lockBotRunLease(tx, lease)
    if (!run || run.stop_requested) throw new Error('Bot 运行租约已失效')
    const token = `devops-run-${randomBytes(32).toString('base64url')}`
    await tx.insert(botRunToken).values({
      team_id: run.team_id,
      run_id: run.id,
      bot_id: run.bot_id,
      user_id: run.trigger_user_id,
      lease_epoch: lease.epoch,
      token_hash: hash(token),
    })
    return token
  })
}

/**
 * 作废指定租约的全部凭据。
 * @param db 运行数据库。
 * @param lease 待撤销的运行与代次。
 * @returns 完成撤销后返回；重复调用不改变已撤销记录。
 * @throws 数据库写入失败时向上传递。
 */
export async function revokeBotRunToken(db: Database, lease: BotRunLease): Promise<void> {
  await db
    .update(botRunToken)
    .set({ revoked_at: new Date(), updated_at: new Date() })
    .where(
      and(eq(botRunToken.run_id, lease.id), eq(botRunToken.lease_epoch, lease.epoch), isNull(botRunToken.revoked_at)),
    )
}

/**
 * 校验凭据哈希、实时租约和成员权限。
 * @param db 认证所用数据库。
 * @param token Bearer 令牌明文，不写日志或持久化。
 * @returns 当前 Bot 身份；无效、停止或失去租约时返回 null。
 * @throws 数据库读取失败时向上传递。
 */
export async function authenticateBotRunToken(db: Database, token: string): Promise<BotActor | null> {
  if (!/^devops-run-[A-Za-z0-9_-]{43}$/u.test(token)) return null
  const [row] = await db
    .select({
      userId: authUser.id,
      email: authUser.email,
      name: authUser.name,
      teamId: botRunToken.team_id,
      botId: botRunToken.bot_id,
      runId: botRunToken.run_id,
      epoch: botRunToken.lease_epoch,
    })
    .from(botRunToken)
    .innerJoin(
      botRun,
      and(
        eq(botRun.id, botRunToken.run_id),
        eq(botRun.team_id, botRunToken.team_id),
        eq(botRun.bot_id, botRunToken.bot_id),
        eq(botRun.trigger_user_id, botRunToken.user_id),
        eq(botRun.lease_epoch, botRunToken.lease_epoch),
        eq(botRun.status, 'running'),
        eq(botRun.stop_requested, false),
        gt(botRun.lease_until, sql`clock_timestamp()`),
      ),
    )
    .innerJoin(bot, and(eq(bot.id, botRun.bot_id), eq(bot.status, 'enabled')))
    .innerJoin(authUser, eq(authUser.id, botRunToken.user_id))
    .innerJoin(
      teamMember,
      and(
        eq(teamMember.team_id, botRunToken.team_id),
        eq(teamMember.user_id, authUser.id),
        eq(teamMember.status, 'active'),
      ),
    )
    .innerJoin(
      botConversationMember,
      and(
        eq(botConversationMember.conversation_id, botRun.conversation_id),
        eq(botConversationMember.member_id, authUser.id),
        eq(botConversationMember.member_kind, 'user'),
        isNull(botConversationMember.removed_at),
      ),
    )
    .where(and(eq(botRunToken.token_hash, hash(token)), isNull(botRunToken.revoked_at)))
    .limit(1)
  return row
    ? {
        user: { id: row.userId, email: row.email, name: row.name },
        credential: 'bot',
        teamId: row.teamId,
        viaBotId: row.botId,
        runId: row.runId,
        leaseEpoch: row.epoch,
      }
    : null
}
