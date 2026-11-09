import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import type { AppConfig } from '../config/env.js'

/**
 * 创建应用专属连接池和 Drizzle 客户端，连接在首次查询时建立。
 * @param config 已校验的应用配置，DATABASE_URL 必须使用应用账号。
 * @param onIdleError 空闲连接出错时的处理函数，只传递稳定错误码，避免泄露连接信息。
 * @returns 数据访问对象、就绪探测和关闭函数；调用方必须在退出时调用 close。
 * @remarks 不自动运行迁移；所有连接使用 UTC，并设置连接、语句、锁和空闲事务超时。
 */
export function createDatabase(config: AppConfig, onIdleError: (code: string | undefined) => void) {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    lock_timeout: config.DB_LOCK_TIMEOUT_MS,
    idle_in_transaction_session_timeout: config.DB_IDLE_TRANSACTION_TIMEOUT_MS,
    options: '-c timezone=UTC',
    application_name: 'dev-ops-api',
  })
  pool.on('error', (error) => {
    onIdleError('code' in error ? String(error.code) : undefined)
  })
  const db = drizzle(pool)

  return {
    db,
    /**
     * 验证数据库可连接且当前账号可访问已迁移的 app schema。
     * @returns 探测成功时完成；连接、权限或 schema 异常时拒绝。
     */
    async check() {
      const result = await db.execute<{ ready: boolean }>(sql`
        SELECT has_schema_privilege(current_user, 'app', 'USAGE') AS ready
      `)
      if (result.rows[0]?.ready !== true) throw new Error('数据库尚未完成初始化')
    },
    /**
     * 关闭连接池并等待已借出的连接归还，应用退出时调用一次。
     * @returns 所有连接关闭后完成；关闭失败时拒绝。
     */
    async close() {
      await pool.end()
    },
  }
}

export type Database = ReturnType<typeof createDatabase>['db']
