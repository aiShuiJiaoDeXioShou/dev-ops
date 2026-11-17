import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import { Client } from 'pg'
import { loadConfig } from '../../src/platform/config/env.ts'
import { createDatabase } from '../../src/platform/database/client.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'

/**
 * 为 Bot 集成测试创建随机命名的本机 PostgreSQL 数据库，应用通过普通运行角色连接。
 * @param t 测试上下文，用于注册连接关闭和数据库清理。
 * @returns 独立数据库配置与应用连接。
 */
export async function createBotTestDatabase(t: TestContext) {
  const { DATABASE_URL, MIGRATION_DATABASE_URL, POSTGRES_PASSWORD } = process.env
  assert.ok(DATABASE_URL && MIGRATION_DATABASE_URL && POSTGRES_PASSWORD, '请先执行 db:setup 和 db:up')
  const runtimeUrl = new URL(DATABASE_URL)
  const migrationUrl = new URL(MIGRATION_DATABASE_URL)
  assert.equal(runtimeUrl.hostname, '127.0.0.1', '只允许使用本机测试数据库')
  assert.equal(runtimeUrl.host, migrationUrl.host)
  assert.equal(runtimeUrl.username, 'dev_ops_app')
  assert.equal(migrationUrl.username, 'dev_ops_migrator')
  const databaseName = `dev_ops_test_bot_${randomUUID().replaceAll('-', '')}`
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || 5432),
    user: 'postgres',
    password: POSTGRES_PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  const cleanup: Array<() => Promise<unknown>> = [() => admin.end()]
  t.after(async () => {
    const failures: unknown[] = []
    for (const release of cleanup.reverse()) {
      try {
        await release()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, '清理 Bot 测试数据库失败')
  })
  await admin.connect()
  await admin.query(`create database "${databaseName}" owner dev_ops_migrator`)
  cleanup.push(() => admin.query(`drop database "${databaseName}" with (force)`))
  await admin.query(`revoke all on database "${databaseName}" from public`)
  await admin.query(`grant connect on database "${databaseName}" to dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'bot-database-test-auth-secret-32-letters',
  })
  const database = createDatabase(config, () => {})
  cleanup.push(database.close)
  return { db: database.db, config, cleanup }
}
