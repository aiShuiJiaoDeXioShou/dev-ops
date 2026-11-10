import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'

function readCookies(header: string | string[] | undefined): string[] {
  if (header === undefined) return []
  const values = Array.isArray(header) ? header : [header]
  return values
    .flatMap((value) => value.split(/,(?=[^;]+=)/))
    .map((value) => value.trim())
    .filter(Boolean)
}

test('Better Auth + PostgreSQL 隔离兼容：无外键、UUID、数据库会话与撤销', { timeout: 60_000 }, async (t) => {
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

  const owner = new Client({ connectionString: migrationUrl.href, connectionTimeoutMillis: 5_000 })
  await owner.connect()
  cleanup.push(async () => {
    await owner.end()
  })

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
  await migrateDatabase(migrationUrl.href)
  const app = createHttpApp(config)
  cleanup.push(async () => {
    await app.close()
  })

  const email = `root-${randomBytes(4).toString('hex')}@example.test`
  const password = 'initial-password-123'
  const signup = await app.auth.api.signUpEmail({ body: { email, password, name: 'root' } })
  assert.match(signup.user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

  const blockedSignup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-up/email',
    payload: { email, password, name: 'root' },
  })
  assert.equal(blockedSignup.statusCode, 404)

  const signIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in/email',
    payload: { email, password },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(signIn.statusCode, 200, signIn.body)
  const cookies = readCookies(signIn.headers['set-cookie'])
  assert.ok(cookies.length > 0)
  assert.ok(cookies.some((cookie) => /httponly/i.test(cookie)))
  const cookieHeader = cookies.map((cookie) => cookie.split(';')[0]).join('; ')

  const session = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/get-session',
    headers: { cookie: cookieHeader },
  })
  assert.equal(session.statusCode, 200, session.body)
  assert.equal(session.json().user.email, email)

  const signOut = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-out',
    headers: { cookie: cookieHeader, origin: config.APP_ORIGIN },
  })
  assert.equal(signOut.statusCode, 200, signOut.body)
  const afterSignOut = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/get-session',
    headers: { cookie: cookieHeader },
  })
  assert.equal(afterSignOut.statusCode, 200)
  assert.equal(afterSignOut.json(), null)

  const userCount = await app.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM app."user"`)
  assert.equal(userCount.rows[0]?.count, 1)
  const fkCount = await owner.query(`
    SELECT count(*)::int AS count FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'app' AND c.contype = 'f'
  `)
  assert.equal(fkCount.rows[0].count, 0)
})
