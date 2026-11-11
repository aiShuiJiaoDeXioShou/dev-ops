import envSchema from 'env-schema'
import { Type, type Static } from 'typebox'
import { validateDatabaseUrl } from './database.ts'

const environmentSchema = Type.Object({
  NODE_ENV: Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')], {
    default: 'development',
  }),
  HOST: Type.String({ minLength: 1, default: '127.0.0.1' }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3001 }),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  DOCS_ENABLED: Type.Optional(Type.Boolean()),
  DATABASE_URL: Type.String({ minLength: 1 }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 100, default: 10 }),
  DB_CONNECT_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 60_000, default: 5_000 }),
  DB_IDLE_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 600_000, default: 30_000 }),
  DB_STATEMENT_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 300_000, default: 10_000 }),
  DB_LOCK_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 60_000, default: 3_000 }),
  DB_IDLE_TRANSACTION_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 600_000, default: 30_000 }),
  APP_ORIGIN: Type.String({ minLength: 1, default: 'http://localhost:5173' }),
  AUTH_SECRET: Type.Optional(Type.String({ minLength: 32 })),
  AUTH_TRUSTED_ORIGINS: Type.Optional(Type.String()),
  SMTP_URL: Type.Optional(Type.String({ minLength: 1 })),
  MAIL_FROM: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
  GIT_CREDENTIAL_ENCRYPTION_KEY: Type.Optional(Type.String({ minLength: 1 })),
  GITHUB_AUTH_MODE: Type.Union([Type.Literal('cli'), Type.Literal('app')], { default: 'cli' }),
  GITHUB_ALLOWED_REPOS: Type.Optional(Type.String()),
  GITHUB_APP_ID: Type.Optional(Type.String({ pattern: '^[0-9]+$' })),
  GITHUB_APP_PRIVATE_KEY_PATH: Type.Optional(Type.String({ minLength: 1 })),
  GITHUB_APP_SLUG: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9-]+$' })),
  PIPELINE_STORAGE_DIR: Type.String({ minLength: 1, default: './pipeline-data' }),
  PIPELINE_RUN_TIMEOUT_SECONDS: Type.Integer({ minimum: 60, maximum: 86_400, default: 3_600 }),
  PIPELINE_LEASE_TTL_SECONDS: Type.Integer({ minimum: 30, maximum: 600, default: 90 }),
  PIPELINE_HEARTBEAT_TIMEOUT_SECONDS: Type.Integer({ minimum: 15, maximum: 300, default: 60 }),
  PIPELINE_LOG_CHUNK_MAX_BYTES: Type.Integer({ minimum: 1_024, maximum: 1_048_576, default: 262_144 }),
  PIPELINE_ARTIFACT_MAX_BYTES: Type.Integer({ minimum: 1_048_576, maximum: 2_147_483_648, default: 524_288_000 }),
  PIPELINE_WORKFLOW_MAX_BYTES: Type.Integer({ minimum: 1_024, maximum: 1_048_576, default: 131_072 }),
  // 流水线产物保留天数；到期清理文件并把元数据标记为 missing。
  PIPELINE_ARTIFACT_RETENTION_DAYS: Type.Integer({ minimum: 1, maximum: 365, default: 30 }),
  ATTACHMENT_STORAGE_DIR: Type.String({ minLength: 1, default: './attachment-data' }),
  ATTACHMENT_MAX_BYTES: Type.Integer({ minimum: 1_048_576, maximum: 2_147_483_648, default: 52_428_800 }),
  ATTACHMENT_MAX_PER_SUBMIT: Type.Integer({ minimum: 1, maximum: 50, default: 10 }),
  ATTACHMENT_MAX_PER_RECORD: Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
  ATTACHMENT_TEMP_TTL_HOURS: Type.Integer({ minimum: 1, maximum: 168, default: 24 }),
  STORAGE_PROBE_TIMEOUT_MS: Type.Integer({ minimum: 1_000, maximum: 60_000, default: 10_000 }),
  // V0.4b 项目写能力与发布：补丁、差异响应与部署验证上限；均为字节或秒。
  CODE_CHANGE_PATCH_MAX_BYTES: Type.Integer({ minimum: 1_024, maximum: 1_048_576, default: 1_048_576 }),
  CODE_CHANGE_DIFF_RESPONSE_MAX_BYTES: Type.Integer({ minimum: 4_096, maximum: 1_048_576, default: 262_144 }),
  CODE_CHANGE_TIMEOUT_SECONDS: Type.Integer({ minimum: 60, maximum: 3_600, default: 900 }),
  DEPLOY_VERIFY_TIMEOUT_SECONDS: Type.Integer({ minimum: 5, maximum: 120, default: 30 }),
  CHANGE_PLAN_LIST_MAX_PAGE_SIZE: Type.Integer({ minimum: 1, maximum: 100, default: 100 }),
})

function validateHttpOrigin(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} 必须是完整的 HTTP 或 HTTPS URL`)
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`${name} 仅支持 HTTP/HTTPS，不能包含凭据、路径、查询参数或片段`)
  }
  return url.origin
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function validateTrustedOrigins(value: string | undefined, appOrigin: string): string[] {
  const origins = splitList(value ?? appOrigin)
  if (!origins.includes(appOrigin)) origins.unshift(appOrigin)
  return origins.map((origin) => validateHttpOrigin(origin, 'AUTH_TRUSTED_ORIGINS'))
}

function validateSmtpUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('SMTP_URL 必须是完整的 SMTP/SMTPS URL')
  }
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname) {
    throw new Error('SMTP_URL 仅支持 smtp:// 或 smtps://')
  }
  return value
}

function validateMailFrom(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
    throw new Error('MAIL_FROM 必须是合法邮箱地址')
  }
  return value
}

function validateEncryptionKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
    throw new Error('GIT_CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节 base64 值')
  }
  return value
}

function validateAllowedRepos(value: string | undefined): string[] {
  const repos = splitList(value)
  for (const repo of repos) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new Error('GITHUB_ALLOWED_REPOS 必须是逗号分隔的 owner/repo')
    }
  }
  return repos
}

/**
 * 校验应用环境变量并应用默认值，不读取或修改配置文件。
 * @param env 环境变量字典，默认使用当前进程环境；DATABASE_URL 必填。
 * @returns 包含数据库、认证、邮件与 GitHub 配置的类型化配置。
 * @throws 参数缺失、数值越界、URL/邮箱/密钥格式不合法时抛出错误，阻止启动。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = envSchema<Static<typeof environmentSchema>>({
    schema: environmentSchema,
    data: env,
    env: false,
  })

  validateDatabaseUrl(config.DATABASE_URL, 'DATABASE_URL')
  const appOrigin = validateHttpOrigin(config.APP_ORIGIN, 'APP_ORIGIN')

  return {
    ...config,
    APP_ORIGIN: appOrigin,
    AUTH_TRUSTED_ORIGINS: validateTrustedOrigins(config.AUTH_TRUSTED_ORIGINS, appOrigin),
    SMTP_URL: validateSmtpUrl(config.SMTP_URL),
    MAIL_FROM: validateMailFrom(config.MAIL_FROM),
    GIT_CREDENTIAL_ENCRYPTION_KEY: validateEncryptionKey(config.GIT_CREDENTIAL_ENCRYPTION_KEY),
    GITHUB_ALLOWED_REPOS: validateAllowedRepos(config.GITHUB_ALLOWED_REPOS),
    DOCS_ENABLED: config.DOCS_ENABLED ?? config.NODE_ENV !== 'production',
  }
}

export type AppConfig = ReturnType<typeof loadConfig>
