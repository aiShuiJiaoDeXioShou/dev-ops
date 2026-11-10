import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('团队资料：管理员更新、名称冲突、版本冲突、非管理员拒绝与活动留痕', { timeout: 90_000 }, async (t) => {
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
    DB_STATEMENT_TIMEOUT_MS: '1000',
    DB_LOCK_TIMEOUT_MS: '100',
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => app.close())

  const adminUser = await createAuthenticatedUser(app, { name: '管理员' })
  const devUser = await createAuthenticatedUser(app, { name: '开发者' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
  ])

  const updated = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/update`,
    payload: { version: 1, name: '研发团队', iconText: '研', description: '内部研发团队' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(updated.json().success, true, updated.body)
  assert.equal(updated.json().data.name, '研发团队')
  assert.equal(updated.json().data.iconText, '研')
  assert.equal(updated.json().data.version, 2)

  const stale = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/update`,
    payload: { version: 1, name: '旧名称' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(stale.json().code, 'VERSION_CONFLICT')

  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/update`,
    payload: { version: 2, name: '开发者改名' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(forbidden.json().code, 'FORBIDDEN')

  const tooLongIcon = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/update`,
    payload: { version: 2, iconText: '超过四个字符' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(tooLongIcon.json().code, 'VALIDATION_ERROR')

  const teams = await app.inject({
    method: 'GET',
    url: '/api/v1/me/teams',
    headers: { cookie: devUser.cookie },
  })
  assert.equal(teams.json().data[0].iconText, '研')
  assert.equal(teams.json().data[0].version, 2)
})
