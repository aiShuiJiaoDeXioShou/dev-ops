import envSchema from 'env-schema'
import { Type, type Static } from 'typebox'
import { validateDatabaseUrl } from './database.js'

const environmentSchema = Type.Object({
  NODE_ENV: Type.Union([
    Type.Literal('development'),
    Type.Literal('test'),
    Type.Literal('production'),
  ], { default: 'development' }),
  HOST: Type.String({ minLength: 1, default: '127.0.0.1' }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3001 }),
  LOG_LEVEL: Type.Union([
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
    Type.Literal('silent'),
  ], { default: 'info' }),
  DOCS_ENABLED: Type.Optional(Type.Boolean()),
  DATABASE_URL: Type.String({ minLength: 1 }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 100, default: 10 }),
  DB_CONNECT_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 60_000, default: 5_000 }),
  DB_IDLE_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 600_000, default: 30_000 }),
  DB_STATEMENT_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 300_000, default: 10_000 }),
  DB_LOCK_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 60_000, default: 3_000 }),
  DB_IDLE_TRANSACTION_TIMEOUT_MS: Type.Integer({ minimum: 1, maximum: 600_000, default: 30_000 }),
})

/**
 * 校验应用环境变量并应用默认值，不读取或修改配置文件。
 * @param env 环境变量字典，默认使用当前进程环境；DATABASE_URL 必填。
 * @returns 包含数据库连接池限制和文档开关的类型化配置。
 * @throws 参数缺失、数值越界或数据库地址不合法时抛出错误，阻止启动。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = envSchema<Static<typeof environmentSchema>>({
    schema: environmentSchema,
    data: env,
    env: false,
  })

  validateDatabaseUrl(config.DATABASE_URL, 'DATABASE_URL')

  return {
    ...config,
    DOCS_ENABLED: config.DOCS_ENABLED ?? config.NODE_ENV !== 'production',
  }
}

export type AppConfig = ReturnType<typeof loadConfig>
