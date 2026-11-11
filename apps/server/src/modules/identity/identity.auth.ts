import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { AppConfig } from '../../platform/config/env.ts'
import type { Database } from '../../platform/database/client.ts'
import { authAccount, authSession, authUser, authVerification } from './identity.tables.ts'

/**
 * 创建平台 Better Auth 实例。
 * @param db 应用共享的 Drizzle 客户端。
 * @param config 已校验配置；必须提供 AUTH_SECRET。
 * @returns 可交给 HTTP 桥接和测试使用的认证实例。
 * @throws 缺少 AUTH_SECRET 时抛出错误，阻止在未配置认证密钥时启动。
 */
/** 认证邮件发送能力；只暴露重置密码所需的字段，避免业务模块依赖具体邮件适配器。 */
export interface AuthMailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>
}

export function createIdentityAuth(db: Database, config: AppConfig, mailer?: AuthMailer | null) {
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
      // 忘记密码：由平台 SMTP 发送重置链接；邮件发送失败时让认证库返回明确错误，不伪造成功。
      sendResetPassword: async ({ user, token }) => {
        if (!mailer) throw new Error('邮件服务未配置，无法发送重置密码邮件')
        const resetUrl = `${config.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`
        await mailer.send({
          to: user.email,
          subject: '重置 DevOps 账号密码',
          text: `请打开以下链接设置新密码（1 小时内有效）：\n${resetUrl}\n\n如果不是你本人操作，请忽略本邮件。`,
        })
      },
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
