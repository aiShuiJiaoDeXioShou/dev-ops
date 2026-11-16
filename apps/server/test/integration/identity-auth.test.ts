import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import sharp from 'sharp'
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

  await t.test('本人可保存和移除头像，图片校验失败时保留既有资料', async () => {
    const url = '/api/v1/auth/update-user'
    const headers = { cookie: cookieHeader, origin: config.APP_ORIGIN }
    const jpeg = await sharp({ create: { width: 160, height: 160, channels: 3, background: 'blue' } })
      .jpeg()
      .toBuffer()
    const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`
    const anonymous = await app.inject({ method: 'POST', url, payload: { image } })
    assert.equal(anonymous.statusCode, 401)

    const update = async (payload: { name?: string; image?: string | null }) =>
      app.inject({ method: 'POST', url, headers, payload })
    const readSession = async () => app.inject({ url: '/api/v1/auth/get-session', headers })
    const uploaded = await update({ name: '新名称', image })
    assert.equal(uploaded.statusCode, 200, uploaded.body)
    assert.equal(uploaded.json().status, true)

    const saved = (await readSession()).json().user
    assert.equal(saved.name, '新名称')
    assert.match(saved.image, /^data:image\/jpeg;base64,/)
    const metadata = await sharp(Buffer.from(saved.image.split(',')[1], 'base64')).metadata()
    assert.equal(metadata.width, 160)
    assert.equal(metadata.height, 160)

    const renamed = await update({ name: '再次改名' })
    assert.equal(renamed.statusCode, 200, renamed.body)
    assert.equal((await readSession()).json().user.image, saved.image)

    for (const invalid of [
      'https://example.test/image.jpg',
      'data:image/jpeg;base64,',
      'data:image/jpeg;base64,/9j/',
    ]) {
      const rejected = await update({ name: '应保留原名称', image: invalid })
      assert.equal(rejected.statusCode, 400, rejected.body)
    }
    const unchanged = (await readSession()).json().user
    assert.equal(unchanged.name, '再次改名')
    assert.equal(unchanged.image, saved.image)

    const removed = await update({ image: null })
    assert.equal(removed.statusCode, 200, removed.body)
    assert.equal((await readSession()).json().user.image, null)
  })

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
