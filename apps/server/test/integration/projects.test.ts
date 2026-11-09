import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { team, teamMember } from '../../src/modules/identity/identity.tables.js'
import { createAuthenticatedUser } from '../support/auth.js'
import { FakeMailer } from '../support/fake-mailer.js'

test('项目创建、筛选、版本冲突、权限、跨团队与活动记录', { timeout: 90_000 }, async (t) => {
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
    DB_STATEMENT_TIMEOUT_MS: '1000',
    DB_LOCK_TIMEOUT_MS: '100',
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })

  const adminUser = await createAuthenticatedUser(app, { name: '管理员' })
  const devUser = await createAuthenticatedUser(app, { name: '开发者' })
  const viewerUser = await createAuthenticatedUser(app, { name: '浏览者' })
  const otherUser = await createAuthenticatedUser(app, { name: '其他团队' })
  const teamId = randomUUID()
  const otherTeamId = randomUUID()
  await app.db.insert(team).values([
    { id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId },
    { id: otherTeamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: otherUser.userId },
  ])
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
    { id: randomUUID(), team_id: otherTeamId, user_id: otherUser.userId, role: 'admin', status: 'active' },
  ])

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '内部平台', description: '说明' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(created.statusCode, 200, created.body)
  const project = created.json().data
  assert.equal(created.json().success, true)
  assert.equal(project.name, '内部平台')
  assert.equal(project.version, 1)
  assert.equal(project.owner.userId, adminUser.userId)
  assert.deepEqual(project.counts, { openRequirements: 0, openBugs: 0 })

  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '内部平台' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(duplicate.json().code, 'PRECONDITION_FAILED')

  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/projects?search=平台&status=active`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(list.json().success, true)
  assert.equal(list.json().data.total, 1)

  const viewerCreate = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '浏览者不能创建' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const updated = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/update`,
    payload: { version: 1, name: '内部平台 v2', status: 'paused', statusReason: '等待排期' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal(updated.json().data.version, 2)
  assert.equal(updated.json().data.name, '内部平台 v2')
  assert.equal(updated.json().data.status, 'paused')

  const conflict = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/update`,
    payload: { version: 1, name: '旧版本' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(conflict.json().code, 'VERSION_CONFLICT')

  const noReason = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/update`,
    payload: { version: 2, status: 'ended' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(noReason.json().code, 'VALIDATION_ERROR')

  const stats = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project.id}/stats`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.deepEqual(stats.json().data, { openRequirements: 0, openBugs: 0 })

  const crossTeam = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project.id}`,
    headers: { cookie: otherUser.cookie },
  })
  assert.equal(crossTeam.json().code, 'FORBIDDEN')

  const activities = await app.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM app.activity WHERE entity_id = ${project.id}`,
  )
  assert.ok((activities.rows[0]?.count ?? 0) >= 2)
})
