import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.js'
import { authUser, invitation, team, teamMember } from './identity.tables.js'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type IdentityExecutor = Database | TransactionDatabase

/**
 * 按邮箱查找用户。
 * @param db 数据库连接。
 * @param email 小写邮箱。
 * @returns 用户摘要或 undefined。
 */
export async function findUserByEmail(db: Database, email: string) {
  const [row] = await db
    .select({ id: authUser.id, email: authUser.email, name: authUser.name })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1)
  return row
}

/**
 * 按标识查找团队。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @returns 团队行或 undefined。
 */
export async function findTeamById(db: Database, teamId: string) {
  const [row] = await db.select().from(team).where(eq(team.id, teamId)).limit(1)
  return row
}

/** 在事务中锁定团队行，串行化成员角色与最后管理员检查。 */
export async function lockTeam(tx: TransactionDatabase, teamId: string) {
  const [row] = await tx.select({ id: team.id }).from(team).where(eq(team.id, teamId)).for('update')
  return row
}

/**
 * 创建团队。
 * @param executor 根连接或事务。
 * @param input 团队标识、名称与创建者。
 * @returns 新团队行。
 */
export async function insertTeam(
  executor: IdentityExecutor,
  input: { id: string; name: string; createdByUserId: string },
) {
  const [row] = await executor
    .insert(team)
    .values({
      id: input.id,
      name: input.name,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('团队创建失败')
  return row
}

/**
 * 创建成员关系。
 * @param executor 根连接或事务。
 * @param input 团队、用户与角色。
 * @returns 新成员行。
 */
export async function insertTeamMember(
  executor: IdentityExecutor,
  input: { id: string; teamId: string; userId: string; role: string; status: string },
) {
  const [row] = await executor
    .insert(teamMember)
    .values({
      id: input.id,
      team_id: input.teamId,
      user_id: input.userId,
      role: input.role,
      status: input.status,
    })
    .returning()
  if (!row) throw new Error('成员创建失败')
  return row
}

/**
 * 查找用户在团队中的成员关系。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param userId 用户标识。
 * @returns 成员行或 undefined。
 */
export async function findMembership(executor: IdentityExecutor, teamId: string, userId: string) {
  const [row] = await executor
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.team_id, teamId), eq(teamMember.user_id, userId)))
    .limit(1)
  return row
}

/**
 * 列出团队正常成员及用户资料。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @returns 成员视图行。
 */
export async function listTeamMembers(db: Database, teamId: string) {
  return db
    .select({
      userId: teamMember.user_id,
      name: authUser.name,
      email: authUser.email,
      role: teamMember.role,
      status: teamMember.status,
      joinedAt: teamMember.joined_at,
    })
    .from(teamMember)
    .innerJoin(authUser, eq(authUser.id, teamMember.user_id))
    .where(eq(teamMember.team_id, teamId))
    .orderBy(asc(teamMember.joined_at), asc(teamMember.user_id))
}

/**
 * 更新成员角色或状态并返回更新行。
 * @param tx 事务连接。
 * @param memberId 成员关系标识。
 * @param values 待更新字段。
 * @returns 更新后的成员行。
 */
export async function updateTeamMember(
  tx: TransactionDatabase,
  memberId: string,
  values: { role?: string; status?: string },
) {
  const [row] = await tx
    .update(teamMember)
    .set({
      ...(values.role === undefined ? {} : { role: values.role }),
      ...(values.status === undefined ? {} : { status: values.status }),
      updated_at: new Date(),
    })
    .where(eq(teamMember.id, memberId))
    .returning()
  return row
}

/** 在事务中统计正常管理员数量。 */
export async function countActiveAdmins(tx: TransactionDatabase, teamId: string) {
  const [row] = await tx
    .select({ value: count() })
    .from(teamMember)
    .where(and(eq(teamMember.team_id, teamId), eq(teamMember.role, 'admin'), eq(teamMember.status, 'active')))
  return row?.value ?? 0
}

/**
 * 列出用户加入的正常团队。
 * @param db 数据库连接。
 * @param userId 用户标识。
 * @returns 团队摘要与角色。
 */
export async function listTeamsForUser(db: Database, userId: string) {
  return db
    .select({
      id: team.id,
      name: team.name,
      role: teamMember.role,
      status: teamMember.status,
    })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.team_id))
    .where(and(eq(teamMember.user_id, userId), eq(teamMember.status, 'active')))
    .orderBy(asc(team.name))
}

/**
 * 插入邀请记录。
 * @param executor 根连接或事务。
 * @returns 新邀请行。
 */
export async function insertInvitation(
  executor: IdentityExecutor,
  input: {
    id: string
    teamId: string
    email: string
    role: string
    tokenHash: string
    invitedByUserId: string
    expiresAt: Date
  },
) {
  const [row] = await executor
    .insert(invitation)
    .values({
      id: input.id,
      team_id: input.teamId,
      email: input.email,
      role: input.role,
      token_hash: input.tokenHash,
      status: 'pending',
      invited_by_user_id: input.invitedByUserId,
      expires_at: input.expiresAt,
    })
    .returning()
  if (!row) throw new Error('邀请创建失败')
  return row
}

/** 按 token 哈希查找邀请，可带锁定。 */
export async function findInvitationByTokenHash(executor: IdentityExecutor, tokenHash: string, lock = false) {
  const query = executor.select().from(invitation).where(eq(invitation.token_hash, tokenHash)).limit(1)
  const [row] = lock ? await query.for('update') : await query
  return row
}

/** 按标识查找邀请。 */
export async function findInvitationById(db: Database, invitationId: string) {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId)).limit(1)
  return row
}

/**
 * 列出团队邀请。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param status 可选状态过滤。
 * @returns 邀请行。
 */
export async function listInvitations(db: Database, teamId: string, status?: string) {
  const conditions = [eq(invitation.team_id, teamId)]
  if (status) conditions.push(eq(invitation.status, status))
  return db
    .select()
    .from(invitation)
    .where(and(...conditions))
    .orderBy(desc(invitation.created_at), desc(invitation.id))
}

/**
 * 更新邀请状态或投递信息。
 * @param executor 根连接或事务。
 * @param invitationId 邀请标识。
 * @param values 待更新字段。
 * @returns 更新后的邀请行。
 */
export async function updateInvitation(
  executor: IdentityExecutor,
  invitationId: string,
  values: {
    tokenHash?: string
    status?: string
    deliveryStatus?: string
    sendAttempts?: number
    lastSentAt?: Date | null
    acceptedAt?: Date | null
    revokedAt?: Date | null
    expiresAt?: Date
  },
) {
  const [row] = await executor
    .update(invitation)
    .set({
      ...(values.tokenHash === undefined ? {} : { token_hash: values.tokenHash }),
      ...(values.status === undefined ? {} : { status: values.status }),
      ...(values.deliveryStatus === undefined ? {} : { delivery_status: values.deliveryStatus }),
      ...(values.sendAttempts === undefined ? {} : { send_attempts: values.sendAttempts }),
      ...(values.lastSentAt === undefined ? {} : { last_sent_at: values.lastSentAt }),
      ...(values.acceptedAt === undefined ? {} : { accepted_at: values.acceptedAt }),
      ...(values.revokedAt === undefined ? {} : { revoked_at: values.revokedAt }),
      ...(values.expiresAt === undefined ? {} : { expires_at: values.expiresAt }),
      updated_at: new Date(),
    })
    .where(eq(invitation.id, invitationId))
    .returning()
  return row
}

/**
 * 按名称查找团队。
 * @param db 数据库连接。
 * @param name 团队名称。
 * @returns 团队行或 undefined。
 */
export async function findTeamByName(db: Database, name: string) {
  const [row] = await db.select().from(team).where(eq(team.name, name)).limit(1)
  return row
}

/**
 * 按标识查找用户摘要。
 * @param executor 数据库连接。
 * @param userId 用户标识。
 * @returns 用户摘要或 undefined。
 */
export async function findUserById(executor: IdentityExecutor, userId: string) {
  const [row] = await executor
    .select({ id: authUser.id, email: authUser.email, name: authUser.name })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1)
  return row
}

/**
 * 查询团队成员关系，仅返回正常状态。
 * @param executor 数据库连接或事务。
 * @param teamId 团队标识。
 * @param userId 用户标识。
 * @returns 正常成员关系或 undefined。
 */
export async function findActiveTeamMember(executor: IdentityExecutor, teamId: string, userId: string) {
  const [row] = await executor
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.team_id, teamId), eq(teamMember.user_id, userId), eq(teamMember.status, 'active')))
    .limit(1)
  return row
}
