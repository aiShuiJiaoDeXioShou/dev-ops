import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { team, teamMember } from '../../src/modules/identity/identity.tables.js'
import { project } from '../../src/modules/projects/projects.tables.js'
import { requirement, requirementTestSubmission } from '../../src/modules/requirements/requirements.tables.js'
import { createAuthenticatedUser } from '../support/auth.js'
import { FakeMailer } from '../support/fake-mailer.js'

test('并发项目更新、最后管理员竞态与重复幂等键', { timeout: 90_000 }, async (t) => {
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
    DB_LOCK_TIMEOUT_MS: '1000',
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })

  const adminA = await createAuthenticatedUser(app, { name: '管理员 A' })
  const adminB = await createAuthenticatedUser(app, { name: '管理员 B' })
  const devUser = await createAuthenticatedUser(app, { name: '开发者' })
  const tester = await createAuthenticatedUser(app, { name: '测试者' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminA.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminA.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: adminB.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: tester.userId, role: 'developer', status: 'active' },
  ])
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '并发项目',
    owner_user_id: adminA.userId,
    created_by_user_id: adminA.userId,
  })

  // 同一版本并发更新：只能一个成功。
  const [updateA, updateB] = await Promise.all([
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/update`,
      payload: { version: 1, name: '并发 A' },
      headers: { cookie: adminA.cookie },
    }),
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/update`,
      payload: { version: 1, name: '并发 B' },
      headers: { cookie: devUser.cookie },
    }),
  ])
  const projectCodes = [updateA.json(), updateB.json()]
  assert.equal(projectCodes.filter((body) => body.success === true).length, 1)
  assert.equal(projectCodes.filter((body) => body.code === 'VERSION_CONFLICT').length, 1)
  const projectActivities = await app.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM app.activity WHERE entity_id = ${projectId} AND action = 'project_updated'`,
  )
  assert.equal(projectActivities.rows[0]?.count, 1)

  // 两位管理员并发互相停用：只能一个成功，且至少保留一位正常管理员。
  const [disableB, disableA] = await Promise.all([
    app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/members/${adminB.userId}/update`,
      payload: { status: 'disabled' },
      headers: { cookie: adminA.cookie },
    }),
    app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/members/${adminA.userId}/update`,
      payload: { status: 'disabled' },
      headers: { cookie: adminB.cookie },
    }),
  ])
  const memberBodies = [disableB.json(), disableA.json()]
  assert.equal(memberBodies.filter((body) => body.success === true).length, 1)
  assert.equal(memberBodies.filter((body) => body.code === 'LAST_ADMIN_PROTECTED').length, 1)
  const activeAdmins = await app.db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM app.team_member
    WHERE team_id = ${teamId} AND role = 'admin' AND status = 'active'
  `)
  assert.equal(activeAdmins.rows[0]?.count, 1)

  // 重复幂等键并发提测：只能创建一条提测记录。
  const requirementId = randomUUID()
  await app.db.insert(requirement).values({
    id: requirementId,
    team_id: teamId,
    project_id: projectId,
    number: 1,
    title: '并发提测',
    content_mode: 'markdown',
    content_markdown: '正文',
    dev_owner_user_id: devUser.userId,
    test_owner_user_id: tester.userId,
    created_by_user_id: adminA.userId,
  })
  const started = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/start-development`,
    payload: { version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(started.json().success, true, started.body)
  const submitPayload = {
    version: 2,
    testOwnerUserId: tester.userId,
    scopeNote: '范围',
    selfTestResult: 'passed',
  }
  const [submitA, submitB] = await Promise.all([
    app.inject({
      method: 'POST',
      url: `/api/v1/requirements/${requirementId}/submit-test`,
      payload: submitPayload,
      headers: { cookie: devUser.cookie, 'idempotency-key': 'concurrent-submit' },
    }),
    app.inject({
      method: 'POST',
      url: `/api/v1/requirements/${requirementId}/submit-test`,
      payload: submitPayload,
      headers: { cookie: devUser.cookie, 'idempotency-key': 'concurrent-submit' },
    }),
  ])
  const submitBodies = [submitA.json(), submitB.json()]
  assert.equal(submitBodies.filter((body) => body.success === true).length, 1)
  assert.equal(submitBodies.filter((body) => body.code === 'IDEMPOTENCY_CONFLICT').length, 1)
  const submissions = await app.db
    .select({ id: requirementTestSubmission.id })
    .from(requirementTestSubmission)
    .where(sql`${requirementTestSubmission.requirement_id} = ${requirementId}`)
  assert.equal(submissions.length, 1)
})
