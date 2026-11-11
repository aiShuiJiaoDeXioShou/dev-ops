import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { bugCollaborator } from '../../src/modules/bugs/bugs.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('Bug 协作人创建/更新持久化、增删活动与校验、版本冲突', { timeout: 90_000 }, async (t) => {
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
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '缺陷协作测试项目',
    owner_user_id: adminUser.userId,
    created_by_user_id: adminUser.userId,
  })

  const createBug = (collaboratorUserIds: string[], cookie = devUser.cookie) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/bugs`,
      payload: {
        title: '协作人缺陷',
        phenomenon: '现象',
        expectedBehavior: '预期',
        reproductionUnknown: true,
        collaboratorUserIds,
      },
      headers: { cookie },
    })

  const created = await createBug([devUser.userId, viewerUser.userId, devUser.userId])
  assert.equal(created.statusCode, 200, created.body)
  const createdBody = created.json()
  assert.equal(createdBody.success, true)
  assert.deepEqual(
    [...createdBody.data.collaborators.map((item: { userId: string }) => item.userId)].sort(),
    [devUser.userId, viewerUser.userId].sort(),
  )
  assert.ok(createdBody.data.collaborators.every((item: { available: boolean }) => item.available))
  const bugId = createdBody.data.id as string

  const persisted = await app.db
    .select({ userId: bugCollaborator.user_id })
    .from(bugCollaborator)
    .where(eq(bugCollaborator.bug_id, bugId))
  assert.equal(persisted.length, 2, '协作人应整删整插后持久化到 bug_collaborator')

  const createActivities = await app.inject({
    method: 'GET',
    url: `/api/v1/bugs/${bugId}/activities`,
    headers: { cookie: viewerUser.cookie },
  })
  const createCollaboratorActivity = createActivities
    .json()
    .data.items.find((item: { action: string }) => item.action === 'bug_collaborators_changed')
  assert.ok(createCollaboratorActivity, '创建协作人应写入活动记录')
  assert.deepEqual([...createCollaboratorActivity.changes.added].sort(), [devUser.userId, viewerUser.userId].sort())
  assert.deepEqual(createCollaboratorActivity.changes.removed, [])

  const viewerCreate = await createBug([devUser.userId], viewerUser.cookie)
  assert.equal(viewerCreate.json().success, false)
  assert.equal(viewerCreate.json().code, 'FORBIDDEN', '浏览者不得通过协作人绕过项目写权限')

  const nonMember = await createBug([otherUser.userId])
  assert.equal(nonMember.json().success, false)
  assert.equal(nonMember.json().code, 'PRECONDITION_FAILED')

  const tooMany = await createBug(Array.from({ length: 21 }, () => randomUUID()))
  assert.equal(tooMany.json().success, false)
  assert.equal(tooMany.json().code, 'VALIDATION_ERROR')

  const updated = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugId}/update`,
    payload: { version: 1, collaboratorUserIds: [devUser.userId] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal(updated.json().data.version, 2)
  assert.deepEqual(
    updated.json().data.collaborators.map((item: { userId: string }) => item.userId),
    [devUser.userId],
  )

  const updatedActivities = await app.inject({
    method: 'GET',
    url: `/api/v1/bugs/${bugId}/activities`,
    headers: { cookie: viewerUser.cookie },
  })
  const latestChange = updatedActivities
    .json()
    .data.items.find((item: { action: string }) => item.action === 'bug_collaborators_changed')
  assert.ok(latestChange, '更新协作人应写入活动记录')
  assert.deepEqual(latestChange.changes.added, [])
  assert.deepEqual(latestChange.changes.removed, [viewerUser.userId])

  const cleared = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugId}/update`,
    payload: { version: 2, collaboratorUserIds: [] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(cleared.statusCode, 200, cleared.body)
  assert.deepEqual(cleared.json().data.collaborators, [])
  const afterClear = await app.db
    .select({ userId: bugCollaborator.user_id })
    .from(bugCollaborator)
    .where(eq(bugCollaborator.bug_id, bugId))
  assert.equal(afterClear.length, 0, '空数组应清空协作人')

  const invalidUpdate = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugId}/update`,
    payload: { version: 3, collaboratorUserIds: [otherUser.userId] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(invalidUpdate.json().code, 'PRECONDITION_FAILED')

  const conflict = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugId}/update`,
    payload: { version: 2, collaboratorUserIds: [devUser.userId] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(conflict.json().code, 'VERSION_CONFLICT')
})
