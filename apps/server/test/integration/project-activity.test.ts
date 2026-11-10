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

test('项目晴雨表：事项活动、项目摘要、筛选、来源未知与权限', { timeout: 90_000 }, async (t) => {
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
  const viewerUser = await createAuthenticatedUser(app, { name: '浏览者' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
  ])
  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '晴雨表项目' },
    headers: { cookie: adminUser.cookie },
  })
  const projectId = created.json().data.id as string
  const requirement = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: { title: '需求一', contentMode: 'markdown', contentMarkdown: '正文' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(requirement.json().success, true, requirement.body)
  const bug = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: { title: 'Bug 一', phenomenon: '现象', expectedBehavior: '预期', reproduction: '步骤' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(bug.json().success, true, bug.body)
  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const activity = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/project-activity?source=activity&from=${from}&to=${today}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(activity.json().success, true, activity.body)
  const data = activity.json().data
  assert.equal(data.timezone, 'UTC')
  assert.equal(data.source, 'activity')
  assert.equal(data.sourceStatus.code, 'unknown')
  assert.equal(data.sourceStatus.pullRequest, 'unknown')
  assert.equal(data.projects.length, 1)
  assert.equal(data.projects[0].items.total, 2)
  assert.equal(data.projects[0].pendingRequirements, 1)
  assert.equal(data.projects[0].pendingBugs, 1)
  assert.equal(data.projects[0].pendingPullRequests, null)
  assert.equal(data.projects[0].bots, null)
  assert.ok(data.days.length >= 7)
  assert.ok(data.days.some((day: { counts: { activity: number } }) => day.counts.activity > 0))

  const filtered = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/project-activity?search=不存在&from=${from}&to=${today}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(filtered.json().data.projects.length, 0)
  assert.equal(
    filtered.json().data.days.every((day: { total: number }) => day.total === 0),
    true,
  )

  const invalidWindow = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/project-activity?from=2024-01-01&to=${today}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidWindow.json().code, 'VALIDATION_ERROR')
})
