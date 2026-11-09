import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { seedRootAccount } from '../../src/modules/identity/identity.seed.js'

test('root 种子命令幂等创建用户与平台管理员，重复执行不重复账号', { timeout: 60_000 }, async (t) => {
  const cleanup: Array<() => Promise<unknown>> = []
  t.after(async () => {
    const errors: unknown[] = []
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, '测试资源清理失败')
  })

  const runtimeValue = process.env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD
  assert.ok(runtimeValue && migrationValue && adminPassword, '请先执行 db:setup 和 db:up')
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  assert.equal(runtimeUrl.hostname, '127.0.0.1', '集成测试仅允许本机 Compose 数据库')
  assert.equal(migrationUrl.host, runtimeUrl.host)
  assert.equal(runtimeUrl.username, 'dev_ops_app')
  assert.equal(migrationUrl.username, 'dev_ops_migrator')

  const databaseName = `dev_ops_test_${randomBytes(8).toString('hex')}`
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  cleanup.push(async () => {
    await admin.end()
  })
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  })
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '500',
    DB_LOCK_TIMEOUT_MS: '50',
  })
  const app = createHttpApp(config)
  cleanup.push(async () => {
    await app.close()
  })

  const email = `root-${randomBytes(4).toString('hex')}@example.test`
  const first = await seedRootAccount(app.db, app.auth, email, 'initial-password-123')
  const second = await seedRootAccount(app.db, app.auth, email, 'another-password-456')
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(first.userId, second.userId)

  const users = await app.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM app."user"`)
  const admins = await app.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM app.platform_admin`)
  const accounts = await app.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM app.account`)
  assert.equal(users.rows[0]?.count, 1)
  assert.equal(admins.rows[0]?.count, 1)
  assert.equal(accounts.rows[0]?.count, 1)
})
