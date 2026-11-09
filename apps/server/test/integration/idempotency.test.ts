import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { team, teamMember } from '../../src/modules/identity/identity.tables.js'
import { createAuthenticatedUser } from '../support/auth.js'
import { FakeMailer } from '../support/fake-mailer.js'

test('通用 POST 幂等钩子：重复键拒绝、业务失败清理后可重试', { timeout: 60_000 }, async (t) => {
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
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })
  const user = await createAuthenticatedUser(app, { name: '管理员' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: user.userId })
  await app.db
    .insert(teamMember)
    .values({ id: randomUUID(), team_id: teamId, user_id: user.userId, role: 'admin', status: 'active' })

  const first = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '幂等项目' },
    headers: { cookie: user.cookie, 'idempotency-key': 'project-create-1' },
  })
  assert.equal(first.json().success, true, first.body)
  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '幂等项目' },
    headers: { cookie: user.cookie, 'idempotency-key': 'project-create-1' },
  })
  assert.equal(duplicate.json().code, 'IDEMPOTENCY_CONFLICT')
  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/projects`,
    headers: { cookie: user.cookie },
  })
  assert.equal(list.json().data.total, 1)

  const failed = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '幂等项目' },
    headers: { cookie: user.cookie, 'idempotency-key': 'project-create-2' },
  })
  assert.equal(failed.json().code, 'PRECONDITION_FAILED')
  const retried = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '重试项目' },
    headers: { cookie: user.cookie, 'idempotency-key': 'project-create-2' },
  })
  assert.equal(retried.json().success, true, retried.body)
})
