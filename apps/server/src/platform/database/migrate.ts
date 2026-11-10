import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { validateDatabaseUrl } from '../config/database.ts'

/**
 * 使用独立账号执行版本化 SQL 迁移，并确保连接在成功或失败后关闭。
 * @param connectionString 迁移账号连接地址，不得使用应用只读写账号。
 * @param migrationsFolder 迁移目录，默认从源码或编译入口定位 apps/server/drizzle。
 * @returns 全部待执行迁移成功后完成；无新迁移时不重复执行。
 * @throws 地址无效、锁获取失败或迁移失败时抛出错误，由命令入口隐藏敏感详情。
 * @remarks 使用会话级 advisory lock 防止本项目的迁移命令并发执行。
 */
export async function migrateDatabase(
  connectionString: string,
  migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url)),
): Promise<void> {
  validateDatabaseUrl(connectionString, 'MIGRATION_DATABASE_URL')
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    lock_timeout: 5_000,
    options: '-c timezone=UTC',
    application_name: 'dev-ops-migrate',
  })
  try {
    const client = await pool.connect()
    try {
      // 会话锁由连接关闭释放；不等待其他迁移，避免两个发布进程交错执行。
      const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(164836, 1) AS locked')
      if (!result.rows[0]?.locked) throw new Error('已有迁移正在执行')
      await migrate(drizzle(client), { migrationsFolder })
    } finally {
      client.release(true)
    }
  } finally {
    await pool.end()
  }
}
