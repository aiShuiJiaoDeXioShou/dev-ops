import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../../platform/config/env.js'
import type { Database } from '../../platform/database/client.js'
import { ApiError } from '../../platform/http/errors.js'
import { ERROR_CODES } from '../../platform/http/error-codes.js'
import type { IdentityAuth } from './identity.auth.js'
import {
  countActiveAdmins,
  findInvitationById,
  findInvitationByTokenHash,
  findMembership,
  findTeamById,
  findTeamByName,
  findUserByEmail,
  findUserById,
  insertInvitation,
  insertTeam,
  insertTeamMember,
  listInvitations,
  listTeamMembers,
  listTeamsForUser,
  lockTeam,
  updateInvitation,
  updateTeamMember,
} from './identity.repository.js'
import { requirePlatformAdmin, requireTeamMember, type SessionUser, type TeamRole } from './identity.session.js'
import {
  createInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_MS,
  isUniqueViolation,
  normalizeEmail,
  normalizeRole,
  normalizeTeamName,
  wouldRemoveLastAdmin,
} from './identity.rules.js'

export interface InvitationView {
  id: string
  teamId: string
  email: string
  role: TeamRole
  status: string
  expiresAt: string
  invitedByUserId: string
  deliveryStatus: string
  createdAt: string
}

export interface TeamMemberView {
  userId: string
  name: string
  email: string
  role: TeamRole
  status: string
  joinedAt: string
}

export interface IdentityMailerPort {
  send(message: { to: string; subject: string; text: string; html?: string }): Promise<void>
}

export interface IdentityServiceDeps {
  db: Database
  auth: IdentityAuth
  config: AppConfig
  mailer: IdentityMailerPort | null
}

function invitationView(
  row: Awaited<ReturnType<typeof insertInvitation>> | NonNullable<Awaited<ReturnType<typeof findInvitationById>>>,
): InvitationView {
  return {
    id: row.id,
    teamId: row.team_id,
    email: row.email,
    role: row.role as TeamRole,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    invitedByUserId: row.invited_by_user_id,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at.toISOString(),
  }
}

function memberView(row: {
  userId: string
  name: string
  email: string
  role: string
  status: string
  joinedAt: Date
}): TeamMemberView {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role as TeamRole,
    status: row.status,
    joinedAt: row.joinedAt.toISOString(),
  }
}

function setCookiesOf(response: Response): string[] {
  return typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
}

/**
 * 创建身份与团队业务服务。
 * @param deps 数据库、认证、配置与邮件发送器。
 * @returns 团队/成员/邀请用例；路由只负责 HTTP 转换。
 */
export function createIdentityService(deps: IdentityServiceDeps) {
  const { db, auth, config } = deps

  async function deliverInvitation(invitation: InvitationView, teamName: string, token: string): Promise<void> {
    if (!deps.mailer) {
      throw new ApiError(ERROR_CODES.EMAIL_DELIVERY_FAILED, '邮件服务未配置', { invitationId: invitation.id })
    }
    const acceptUrl = `${config.APP_ORIGIN}/accept-invitation?token=${encodeURIComponent(token)}`
    try {
      await deps.mailer.send({
        to: invitation.email,
        subject: `加入团队「${teamName}」的邀请`,
        text: `你被邀请加入团队「${teamName}」，角色为 ${invitation.role}。请在 ${new Date(invitation.expiresAt).toLocaleString('zh-CN')} 前打开以下链接完成加入：\n${acceptUrl}\n\n如果不是你本人操作，请忽略本邮件。`,
      })
      const current = await findInvitationById(db, invitation.id)
      await updateInvitation(db, invitation.id, {
        deliveryStatus: 'sent',
        sendAttempts: (current?.send_attempts ?? 0) + 1,
        lastSentAt: new Date(),
      })
    } catch {
      const current = await findInvitationById(db, invitation.id)
      await updateInvitation(db, invitation.id, {
        deliveryStatus: 'failed',
        sendAttempts: (current?.send_attempts ?? 0) + 1,
      })
      throw new ApiError(ERROR_CODES.EMAIL_DELIVERY_FAILED, '邀请邮件发送失败，可稍后重发', {
        invitationId: invitation.id,
      })
    }
  }

  async function createTeamAsRoot(rootUser: SessionUser, input: { name: string; adminEmail: string }) {
    await requirePlatformAdmin(db, rootUser.id)
    const name = normalizeTeamName(input.name)
    const email = normalizeEmail(input.adminEmail)
    if (await findTeamByName(db, name)) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '团队名称已存在')

    const teamId = randomUUID()
    const token = createInvitationToken()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    const result = await db.transaction(async (tx) => {
      const teamRow = await insertTeam(tx, { id: teamId, name, createdByUserId: rootUser.id })
      const invitationRow = await insertInvitation(tx, {
        id: randomUUID(),
        teamId,
        email,
        role: 'admin',
        tokenHash: hashInvitationToken(token),
        invitedByUserId: rootUser.id,
        expiresAt,
      })
      return { teamRow, invitationRow }
    })
    const view = invitationView(result.invitationRow)
    await deliverInvitation(view, name, token)
    return { team: { id: result.teamRow.id, name: result.teamRow.name }, invitation: view }
  }

  async function inviteMember(actor: SessionUser, teamId: string, input: { email: string; role: string }) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const teamRow = await findTeamById(db, teamId)
    if (!teamRow) throw new ApiError(ERROR_CODES.NOT_FOUND, '团队不存在')
    const email = normalizeEmail(input.email)
    const role = normalizeRole(input.role)
    const token = createInvitationToken()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    let row
    try {
      row = await insertInvitation(db, {
        id: randomUUID(),
        teamId,
        email,
        role,
        tokenHash: hashInvitationToken(token),
        invitedByUserId: actor.id,
        expiresAt,
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '该邮箱已有待接受邀请')
      throw error
    }
    const view = invitationView(row)
    await deliverInvitation(view, teamRow.name, token)
    return view
  }

  async function resendInvitation(actor: SessionUser, teamId: string, invitationId: string) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const row = await findInvitationById(db, invitationId)
    if (!row || row.team_id !== teamId) throw new ApiError(ERROR_CODES.NOT_FOUND, '邀请不存在')
    if (row.status !== 'pending') throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '只有待接受邀请可以重发')
    const teamRow = await findTeamById(db, teamId)
    if (!teamRow) throw new ApiError(ERROR_CODES.NOT_FOUND, '团队不存在')
    const token = createInvitationToken()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    const updated = await updateInvitation(db, invitationId, {
      tokenHash: hashInvitationToken(token),
      expiresAt,
      deliveryStatus: 'pending',
      acceptedAt: null,
      revokedAt: null,
    })
    if (!updated) throw new ApiError(ERROR_CODES.NOT_FOUND, '邀请不存在')
    const view = invitationView(updated)
    await deliverInvitation(view, teamRow.name, token)
    return view
  }

  async function revokeInvitation(actor: SessionUser, teamId: string, invitationId: string) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const row = await findInvitationById(db, invitationId)
    if (!row || row.team_id !== teamId) throw new ApiError(ERROR_CODES.NOT_FOUND, '邀请不存在')
    if (row.status !== 'pending') throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '只有待接受邀请可以撤销')
    const updated = await updateInvitation(db, invitationId, { status: 'revoked', revokedAt: new Date() })
    return invitationView(updated ?? row)
  }

  async function listTeamInvitations(actor: SessionUser, teamId: string, status?: string) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const rows = await listInvitations(db, teamId, status)
    return rows.map(invitationView)
  }

  async function listMembers(actor: SessionUser, teamId: string) {
    await requireTeamMember(db, actor.id, teamId)
    const rows = await listTeamMembers(db, teamId)
    return rows.map(memberView)
  }

  async function updateMember(
    actor: SessionUser,
    teamId: string,
    targetUserId: string,
    input: { role?: string; status?: string },
  ) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    if (input.role === undefined && input.status === undefined) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '至少提供一个待更新字段')
    }
    if (input.role !== undefined) normalizeRole(input.role)
    if (input.status !== undefined && !['active', 'disabled'].includes(input.status)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '成员状态不合法')
    }

    const updated = await db.transaction(async (tx) => {
      await lockTeam(tx, teamId)
      const membership = await findMembership(tx, teamId, targetUserId)
      if (!membership) throw new ApiError(ERROR_CODES.NOT_FOUND, '团队成员不存在')
      if (wouldRemoveLastAdmin(membership.role, membership.status, input, await countActiveAdmins(tx, teamId))) {
        throw new ApiError(ERROR_CODES.LAST_ADMIN_PROTECTED, '至少保留一位正常管理员')
      }
      const row = await updateTeamMember(tx, membership.id, input)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '团队成员不存在')
      return row
    })
    const user = await findUserById(db, targetUserId)
    if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, '用户不存在')
    return memberView({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: updated.role,
      status: updated.status,
      joinedAt: updated.joined_at,
    })
  }

  async function getInvitationByToken(token: string) {
    const row = await findInvitationByTokenHash(db, hashInvitationToken(token))
    if (!row) throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请无效或已失效')
    if (row.status !== 'pending') throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请无效或已失效')
    if (row.expires_at.getTime() <= Date.now()) {
      await updateInvitation(db, row.id, { status: 'expired' })
      throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请已过期')
    }
    const teamRow = await findTeamById(db, row.team_id)
    if (!teamRow) throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请无效或已失效')
    return {
      teamName: teamRow.name,
      email: row.email,
      role: row.role as TeamRole,
      expiresAt: row.expires_at.toISOString(),
    }
  }

  async function acceptInvitation(token: string, input: { password: string; name: string }) {
    if (input.password.length < 8 || input.password.length > 128) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '密码长度必须在 8-128 个字符之间')
    }
    const name = input.name.trim()
    if (name.length === 0 || name.length > 120) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '用户名长度不合法')
    const tokenHash = hashInvitationToken(token)
    const invitationRow = await findInvitationByTokenHash(db, tokenHash)
    if (!invitationRow) throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请无效或已失效')
    if (invitationRow.status !== 'pending') throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请无效或已失效')
    if (invitationRow.expires_at.getTime() <= Date.now()) {
      await updateInvitation(db, invitationRow.id, { status: 'expired' })
      throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请已过期')
    }

    const existingUser = await findUserByEmail(db, invitationRow.email)
    let response: Response
    try {
      response = existingUser
        ? await auth.api.signInEmail({
            body: { email: invitationRow.email, password: input.password },
            asResponse: true,
          })
        : await auth.api.signUpEmail({
            body: { email: invitationRow.email, password: input.password, name },
            asResponse: true,
          })
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
      if (status === 401 || existingUser) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '邮箱或密码不正确')
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '账号创建失败，请重试')
    }
    if (!response.ok) {
      throw new ApiError(
        existingUser ? ERROR_CODES.UNAUTHENTICATED : ERROR_CODES.PRECONDITION_FAILED,
        '账号认证失败，请检查邮箱和密码',
      )
    }
    const cookies = setCookiesOf(response)
    let userId = existingUser?.id
    if (!userId) {
      const payload = (await response.clone().json()) as { user?: { id?: string } }
      userId = payload.user?.id
    }
    if (!userId) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '账号创建结果不完整，请重试')

    const teamRow = await findTeamById(db, invitationRow.team_id)
    if (!teamRow) throw new ApiError(ERROR_CODES.INVITATION_INVALID, '邀请无效或已失效')

    await db.transaction(async (tx) => {
      const locked = await findInvitationByTokenHash(tx, tokenHash, true)
      if (!locked || locked.status !== 'pending')
        throw new ApiError(ERROR_CODES.INVITATION_ALREADY_ACCEPTED, '邀请已被接受或已失效')
      const membership = await findMembership(tx, locked.team_id, userId)
      if (membership) {
        if (membership.role !== locked.role)
          throw new ApiError(ERROR_CODES.INVITATION_ALREADY_ACCEPTED, '该邮箱已是团队成员')
      } else {
        await insertTeamMember(tx, {
          id: randomUUID(),
          teamId: locked.team_id,
          userId,
          role: locked.role,
          status: 'active',
        })
      }
      await updateInvitation(tx, locked.id, { status: 'accepted', acceptedAt: new Date() })
    })

    return { userId, teamId: teamRow.id, teamName: teamRow.name, role: invitationRow.role as TeamRole, cookies }
  }

  async function listMyTeams(user: SessionUser) {
    const rows = await listTeamsForUser(db, user.id)
    return rows.map((row) => ({ ...row, role: row.role as TeamRole }))
  }

  return {
    createTeamAsRoot,
    inviteMember,
    resendInvitation,
    revokeInvitation,
    listTeamInvitations,
    listMembers,
    updateMember,
    getInvitationByToken,
    acceptInvitation,
    listMyTeams,
  }
}

export type IdentityService = ReturnType<typeof createIdentityService>
