import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { AppConfig } from '../../platform/config/env.js'
import type { Database } from '../../platform/database/client.js'
import { authAccount, authSession, authUser, authVerification } from './identity.tables.js'

/**
 * 创建平台 Better Auth 实例。
 * @param db 应用共享的 Drizzle 客户端。
 * @param config 已校验配置；必须提供 AUTH_SECRET。
 * @returns 可交给 HTTP 桥接和测试使用的认证实例。
 * @throws 缺少 AUTH_SECRET 时抛出错误，阻止在未配置认证密钥时启动。
 */
export function createIdentityAuth(db: Database, config: AppConfig) {
  if (!config.AUTH_SECRET) {
    throw new Error('AUTH_SECRET 必须配置后才能启用认证')
  }

  return betterAuth({
    appName: 'dev-ops',
    baseURL: config.APP_ORIGIN,
    basePath: '/api/v1/auth',
    secret: config.AUTH_SECRET,
    trustedOrigins: config.AUTH_TRUSTED_ORIGINS,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
      },
      usePlural: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    user: {
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
    },
  })
}

export type IdentityAuth = ReturnType<typeof createIdentityAuth>
