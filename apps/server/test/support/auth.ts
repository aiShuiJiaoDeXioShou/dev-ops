import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

/** 从响应头提取 Cookie 并拼成请求头值；忽略属性部分。 */
export function cookieHeaderFrom(header: string | string[] | undefined): string {
  if (header === undefined) return ''
  const values = Array.isArray(header) ? header : [header]
  return values
    .flatMap((value) => value.split(/,(?=[^;]+=)/))
    .map((value) => value.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')
}

/** 创建随机测试邮箱。 */
export function testEmail(prefix = 'user'): string {
  return `${prefix}-${randomBytes(4).toString('hex')}@example.test`
}

/**
 * 通过 Better Auth 内部 API 创建用户并登录，返回可复用的 Cookie。
 * @param app 测试应用，必须连接真实隔离数据库。
 * @param input 邮箱、密码与用户名。
 * @returns 用户标识、邮箱与 Cookie 请求头值。
 */
export async function createAuthenticatedUser(
  app: FastifyInstance,
  input: {
    email?: string
    password?: string
    name?: string
  } = {},
) {
  const email = input.email ?? testEmail()
  const password = input.password ?? 'test-password-123'
  const name = input.name ?? '测试用户'
  const signup = await app.auth.api.signUpEmail({ body: { email, password, name } })
  const signin = await app.auth.api.signInEmail({ body: { email, password }, asResponse: true })
  if (!signin.ok) throw new Error(`测试用户登录失败：${signin.status}`)
  return {
    userId: signup.user.id,
    email,
    password,
    name,
    cookie: cookieHeaderFrom(signin.headers.getSetCookie()),
  }
}
