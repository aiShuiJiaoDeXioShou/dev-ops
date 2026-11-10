import type { IncomingHttpHeaders } from 'node:http'
import { APIError } from 'better-auth/api'
import type { IdentityAuth } from './identity.auth.ts'
import { toAuthHeaders } from './identity.session.ts'

/**
 * 校验当前登录会话用户本次输入的登录密码。
 * @param auth Better Auth 实例。
 * @param headers 原始请求头，用于定位当前 Cookie 会话；不接受 API Token。
 * @param password 用户在敏感操作确认框中输入的当前密码。
 * @returns 密码正确返回 true；密码错误返回 false。
 * @throws 会话失效或其他认证异常时向上抛出，由统一错误处理转换为业务错误。
 * @remarks 只做二次身份确认，不创建新会话、不轮换当前会话，也不在服务端保留输入的密码。
 */
export async function verifySessionPassword(
  auth: IdentityAuth,
  headers: IncomingHttpHeaders,
  password: string,
): Promise<boolean> {
  try {
    const result = await auth.api.verifyPassword({
      body: { password },
      headers: toAuthHeaders(headers),
    })
    return result.status === true
  } catch (error) {
    if (error instanceof APIError && error.body?.code === 'INVALID_PASSWORD') return false
    throw error
  }
}
