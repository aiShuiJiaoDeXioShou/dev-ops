import { eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import type { IdentityAuth } from './identity.auth.ts'
import { authUser, platformAdmin } from './identity.tables.ts'

/**
 * 幂等初始化平台 root 账号。
 * @param db 应用数据库连接。
 * @param auth Better Auth 实例，用于创建密码凭据。
 * @param email root 登录邮箱。
 * @param password root 初始密码，仅首次创建账号时使用。
 * @returns 账号标识及是否为本次创建；重复执行不修改已有密码。
 * @throws 邮箱/密码格式不合法或数据库/认证创建失败时抛出错误。
 */
export async function seedRootAccount(db: Database, auth: IdentityAuth, email: string, password: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ROOT_EMAIL 必须是合法邮箱')
  if (password.length < 8) throw new Error('ROOT_INITIAL_PASSWORD 至少 8 个字符')

  const [existing] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)).limit(1)
  if (existing) {
    await db.insert(platformAdmin).values({ user_id: existing.id }).onConflictDoNothing()
    return { userId: existing.id, created: false }
  }

  const result = await auth.api.signUpEmail({
    body: { email, password, name: email.split('@')[0] ?? 'root' },
  })
  await db.insert(platformAdmin).values({ user_id: result.user.id }).onConflictDoNothing()
  return { userId: result.user.id, created: true }
}
