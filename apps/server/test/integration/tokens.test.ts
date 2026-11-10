import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { personalAccessToken } from '../../src/modules/identity/identity.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('API Token 创建、Bearer 鉴权、管理接口拒绝 Token、撤销与过期', { timeout: 90_000 }, async (t) => {
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
  cleanup.push(async () => admin.end())
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`))
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
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => app.close())
  const user = await createAuthenticatedUser(app)

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/me/tokens',
    headers: { cookie: user.cookie },
    payload: { name: 'integration', expiresInDays: 30 },
  })
  assert.equal(create.statusCode, 200)
  const created = create.json()
  assert.equal(created.success, true)
  const token: string = created.data.token
  assert.match(token, /^devops_pat_/)

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/v1/me/tokens',
    headers: { cookie: user.cookie },
    payload: { name: 'integration' },
  })
  assert.equal(duplicate.json().success, false)
  assert.equal(duplicate.json().code, 'TOKEN_NAME_DUPLICATE')

  const stored = await app.db.select().from(personalAccessToken)
  assert.equal(stored.length, 1)
  assert.notEqual(stored[0]?.token_hash, token)
  assert.equal(stored[0]?.token_hash.length, 64)

  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(me.json().success, true)
  assert.equal(me.json().data.user.email, user.email)

  const listWithToken = await app.inject({
    method: 'GET',
    url: '/api/v1/me/tokens',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(listWithToken.json().success, false)
  assert.equal(listWithToken.json().code, 'FORBIDDEN')

  const teams = await app.inject({
    method: 'GET',
    url: '/api/v1/me/teams',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(teams.json().success, true)

  const revoke = await app.inject({
    method: 'POST',
    url: `/api/v1/me/tokens/${created.data.metadata.id}/revoke`,
    headers: { cookie: user.cookie },
    payload: {},
  })
  assert.equal(revoke.json().data.status, 'revoked')

  const after = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(after.json().success, false)
  assert.equal(after.json().code, 'UNAUTHENTICATED')

  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/me/tokens',
    headers: { cookie: user.cookie },
    payload: { name: 'expired' },
  })
  const secondToken: string = second.json().data.token
  await app.db
    .update(personalAccessToken)
    .set({ expires_at: new Date(Date.now() - 1_000) })
    .where((await import('drizzle-orm')).eq(personalAccessToken.id, second.json().data.metadata.id))
  const expired = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${secondToken}` },
  })
  assert.equal(expired.json().code, 'UNAUTHENTICATED')
})
