import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { authUser, invitation, platformAdmin, team, teamMember } from './identity.tables.ts'
import type { UserSummary } from './identity.types.ts'

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
 * 判断用户是否拥有平台管理员身份。
 * @param db 数据库连接。
 * @param userId 用户标识。
 * @returns 在 platform_admin 表中存在记录时为 true。
 */
export async function isPlatformAdminUser(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: platformAdmin.user_id })
    .from(platformAdmin)
    .where(eq(platformAdmin.user_id, userId))
    .limit(1)
  return row !== undefined
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
      iconText: team.icon_text,
      description: team.description,
      version: team.version,
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
 * 按标识批量读取用户摘要，供其他模块一次填充负责人姓名，替代逐条查询。
 * @param executor 数据库连接或事务。
 * @param userIds 用户标识集合；重复标识会被去重。
 * @returns 用户摘要数组；空数组直接返回空数组，不访问数据库。
 */
export async function findUserSummariesByIds(executor: IdentityExecutor, userIds: string[]): Promise<UserSummary[]> {
  if (userIds.length === 0) return []
  const uniqueUserIds = [...new Set(userIds)]
  return executor
    .select({ id: authUser.id, name: authUser.name })
    .from(authUser)
    .where(inArray(authUser.id, uniqueUserIds))
}

/**
 * 批量筛查团队内正常状态的成员标识，用于一次校验多个负责人或协作人。
 * @param executor 数据库连接或事务。
 * @param teamId 团队标识。
 * @param userIds 待校验的用户标识集合；重复标识会被去重。
 * @returns 属于团队正常成员的用户标识集合；空数组直接返回空集合。
 */
export async function findActiveTeamMemberIds(
  executor: IdentityExecutor,
  teamId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await executor
    .select({ userId: teamMember.user_id })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.team_id, teamId),
        eq(teamMember.status, 'active'),
        inArray(teamMember.user_id, [...new Set(userIds)]),
      ),
    )
  return new Set(rows.map((row) => row.userId))
}

/**
 * 判断用户是否为团队正常成员。
 * @param executor 数据库连接或事务。
 * @param teamId 团队标识。
 * @param userId 用户标识。
 * @returns 是正常成员返回 true，否则返回 false。
 */
export async function isActiveTeamMember(executor: IdentityExecutor, teamId: string, userId: string): Promise<boolean> {
  const activeIds = await findActiveTeamMemberIds(executor, teamId, [userId])
  return activeIds.has(userId)
}

/**
 * 按版本条件更新团队资料。
 * @param executor 数据库连接或事务。
 * @param teamId 团队标识。
 * @param expectedVersion 期望版本。
 * @param fields 允许更新的名称、图标标识与说明。
 * @returns 更新后的团队行；版本不匹配返回 undefined。
 */
export async function updateTeamProfile(
  executor: IdentityExecutor,
  teamId: string,
  expectedVersion: number,
  fields: { name?: string; iconText?: string | null; description?: string | null },
) {
  const [row] = await executor
    .update(team)
    .set({
      ...(fields.name === undefined ? {} : { name: fields.name }),
      ...(fields.iconText === undefined ? {} : { icon_text: fields.iconText }),
      ...(fields.description === undefined ? {} : { description: fields.description }),
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(and(eq(team.id, teamId), eq(team.version, expectedVersion)))
    .returning()
  return row
}

/**
 * 批量读取团队内成员的当前状态，用于展示负责人是否可用。
 * @param executor 数据库连接或事务。
 * @param teamId 团队标识。
 * @param userIds 待查询用户标识集合；重复项会去重。
 * @returns 用户标识到团队状态的 Map；不在团队中的用户不出现在结果里。
 */
export async function findTeamMemberStatuses(
  executor: IdentityExecutor,
  teamId: string,
  userIds: string[],
): Promise<Map<string, 'active' | 'disabled'>> {
  if (userIds.length === 0) return new Map()
  const rows = await executor
    .select({ userId: teamMember.user_id, status: teamMember.status })
    .from(teamMember)
    .where(and(eq(teamMember.team_id, teamId), inArray(teamMember.user_id, [...new Set(userIds)])))
  return new Map(rows.map((row) => [row.userId, row.status === 'active' ? 'active' : 'disabled'] as const))
}
