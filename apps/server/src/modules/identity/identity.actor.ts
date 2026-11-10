import type { FastifyRequest } from 'fastify'
import type { IncomingHttpHeaders } from 'node:http'
import { ApiError as ApiErrorClass } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { IdentityAuth } from './identity.auth.ts'
import { getSessionUser, type SessionUser } from './identity.session.ts'
import type { TokenService } from './identity.tokens.ts'

export interface Actor {
  user: SessionUser
  credential: 'session' | 'token'
}

function bearerToken(headers: IncomingHttpHeaders): string | null {
  const value = headers.authorization
  if (typeof value !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]?.trim() || null
}

/**
 * 解析请求身份：API Token 优先，其次现有 Cookie 会话。
 * @param auth Better Auth 实例。
 * @param tokens API Token 服务。
 * @param headers 原始请求头。
 * @returns 已认证 actor；无有效凭据返回 null。
 * @remarks Authorization 存在但无效时不回退 Cookie，避免不同凭据混用。
 */
export async function resolveActor(
  auth: IdentityAuth,
  tokens: TokenService,
  headers: IncomingHttpHeaders,
): Promise<Actor | null> {
  const token = bearerToken(headers)
  if (token !== null) {
    const authenticated = await tokens.authenticate(token)
    if (!authenticated) return null
    return { user: authenticated.user, credential: 'token' }
  }
  const user = await getSessionUser(auth, headers)
  return user ? { user, credential: 'session' } : null
}

/**
 * 要求当前请求具有有效身份（API Token 或 Cookie 会话）。
 * @param request Fastify 请求，实例已装饰 db/auth/tokenService。
 * @returns 当前用户。
 * @throws 无有效凭据时抛出 UNAUTHENTICATED。
 */
export async function requireActor(request: FastifyRequest): Promise<SessionUser> {
  const actor = await resolveActor(request.server.auth, request.server.tokenService, request.headers)
  if (!actor) throw new ApiErrorClass(ERROR_CODES.UNAUTHENTICATED, '请先登录或提供有效 API Token')
  return actor.user
}

/**
 * 要求当前请求来自登录会话，禁止 API Token 管理 Token。
 * @param request Fastify 请求。
 * @returns 当前登录用户。
 * @throws 使用 API Token 时抛出 FORBIDDEN；无会话时抛出 UNAUTHENTICATED。
 */
export async function requireSessionActor(request: FastifyRequest): Promise<SessionUser> {
  const token = bearerToken(request.headers)
  if (token !== null) {
    throw new ApiErrorClass(ERROR_CODES.FORBIDDEN, 'API Token 不能管理 API Token')
  }
  const user = await getSessionUser(request.server.auth, request.headers)
  if (!user) throw new ApiErrorClass(ERROR_CODES.UNAUTHENTICATED, '请先登录')
  return user
}
