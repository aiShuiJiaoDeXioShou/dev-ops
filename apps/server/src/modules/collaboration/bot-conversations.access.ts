import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import type { BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { teamMember } from '../identity/identity.tables.ts'
import { botConversation, botConversationMember } from './bot-conversations.tables.ts'

type ReadDb = Pick<Database, 'select'>

/** 抛出统一的会话不可见业务错误，避免泄露会话是否存在。 */
export function accessError(): never {
  throw new ApiError(ERROR_CODES.BOT_CONVERSATION_NOT_FOUND, '会话不存在或不可见')
}

/**
 * 生成只包含当前用户有效会话成员关系的查询。
 * @param db 数据库或事务。
 * @param actor 当前用户标识。
 * @returns 可继续按会话或团队过滤的查询。
 */
export function membershipQuery(db: ReadDb, actor: Pick<SessionUser, 'id'>) {
  return db
    .select({ row: botConversation, role: teamMember.role })
    .from(botConversation)
    .innerJoin(
      botConversationMember,
      and(
        eq(botConversationMember.conversation_id, botConversation.id),
        eq(botConversationMember.team_id, botConversation.team_id),
        eq(botConversationMember.member_kind, 'user'),
        eq(botConversationMember.member_id, actor.id),
        isNull(botConversationMember.removed_at),
      ),
    )
    .innerJoin(
      teamMember,
      and(
        eq(teamMember.team_id, botConversation.team_id),
        eq(teamMember.user_id, actor.id),
        eq(teamMember.status, 'active'),
      ),
    )
}

/**
 * 校验用户当前具备会话可见权限。团队或平台级角色不替代成员关系。
 * @param db 数据库或当前事务。
 * @param actor 当前认证成员。
 * @param conversationId 会话标识。
 * @param edit 是否要求写权限。
 * @returns 有效会话；失去成员资格时以不可见处理。
 */
export async function requireBotConversation(
  db: ReadDb,
  actor: Pick<SessionUser, 'id'>,
  conversationId: string,
  edit = false,
) {
  const [member] = await membershipQuery(db, actor).where(eq(botConversation.id, conversationId))
  if (!member) accessError()
  if (edit && member.role !== 'admin' && member.role !== 'developer') {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '当前角色只可阅读此会话')
  }
  return member.row
}

/**
 * 先锁会话行再读取编辑权限，用于串行分配消息序号与变更关联成员。
 * @param tx 将执行写入的事务。
 * @param actor 当前认证成员。
 * @param conversationId 会话标识。
 * @returns 已锁定且当前可写的会话。
 */
export async function lockWritableBotConversation(
  tx: BotRunTransaction,
  actor: Pick<SessionUser, 'id'>,
  conversationId: string,
) {
  const [locked] = await tx
    .select({ id: botConversation.id })
    .from(botConversation)
    .where(eq(botConversation.id, conversationId))
    .for('update')
  if (!locked) accessError()
  return requireBotConversation(tx, actor, conversationId, true)
}
