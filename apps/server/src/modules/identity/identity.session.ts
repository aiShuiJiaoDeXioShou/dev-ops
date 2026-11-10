import { and, eq, inArray } from 'drizzle-orm'
import type { IncomingHttpHeaders } from 'node:http'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { Database } from '../../platform/database/client.ts'
import type { IdentityAuth } from './identity.auth.ts'
import { platformAdmin, teamMember } from './identity.tables.ts'

export type TeamRole = 'admin' | 'developer' | 'viewer'

export interface SessionUser {
  id: string
  email: string
  name: string
}

/** 将 Fastify/Node 请求头转换为 Better Auth 需要的 Headers。 */
export function toAuthHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) result.append(name, item)
    else result.set(name, value)
  }
  return result
}

/**
 * 读取当前请求用户。
 * @param auth Better Auth 实例。
 * @param headers 原始 Node 请求头。
 * @returns 有效用户；无会话或会话失效时返回 null。
 */
export async function getSessionUser(auth: IdentityAuth, headers: IncomingHttpHeaders): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: toAuthHeaders(headers) })
  if (!session?.user) return null
  return { id: session.user.id, email: session.user.email, name: session.user.name }
}

/**
 * 要求当前请求具有有效会话。
 * @param auth Better Auth 实例。
 * @param headers 原始 Node 请求头。
 * @returns 当前用户。
 * @throws 无有效会话时抛出 UNAUTHENTICATED。
 */
export async function requireSessionUser(auth: IdentityAuth, headers: IncomingHttpHeaders): Promise<SessionUser> {
  const user = await getSessionUser(auth, headers)
  if (!user) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '请先登录')
  return user
}

/**
 * 要求用户是正常团队管理员。
 * @param db 数据库连接。
 * @param userId 用户标识。
 * @returns 无返回值。
 * @throws 非正常管理员时抛出 FORBIDDEN。
 */
export async function requirePlatformAdmin(db: Database, userId: string): Promise<void> {
  const [row] = await db
    .select({ userId: platformAdmin.user_id })
    .from(platformAdmin)
    .where(eq(platformAdmin.user_id, userId))
    .limit(1)
  if (!row) throw new ApiError(ERROR_CODES.FORBIDDEN, '需要平台管理员权限')
}

/**
 * 要求用户是正常团队成员，可附加允许角色。
 * @param db 数据库连接。
 * @param userId 用户标识。
 * @param teamId 团队标识。
 * @param roles 允许的角色；为空时不限制角色。
 * @returns 成员关系。
 * @throws 非正常成员或角色不符时抛出 FORBIDDEN。
 */
export async function requireTeamMember(db: Database, userId: string, teamId: string, roles?: TeamRole[]) {
  const conditions = [eq(teamMember.team_id, teamId), eq(teamMember.user_id, userId), eq(teamMember.status, 'active')]
  if (roles && roles.length > 0) {
    conditions.push(inArray(teamMember.role, roles))
  }
  const [row] = await db
    .select()
    .from(teamMember)
    .where(and(...conditions))
    .limit(1)
  if (!row) throw new ApiError(ERROR_CODES.FORBIDDEN, '无权访问该团队')
  return row
}
