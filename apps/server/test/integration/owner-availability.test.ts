import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { requirement } from '../../src/modules/requirements/requirements.tables.ts'
import { bug, bugRequirementLink } from '../../src/modules/bugs/bugs.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('负责人可用性、ownerUnavailable 筛选与需求 needsReview', { timeout: 90_000 }, async (t) => {
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
  const app = createHttpApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: runtimeUrl.href,
      AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
      APP_ORIGIN: 'http://localhost:5173',
      AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    }),
    { mailer: new FakeMailer() },
  )
  cleanup.push(async () => app.close())
  const adminUser = await createAuthenticatedUser(app, { name: '管理员' })
  const ownerUser = await createAuthenticatedUser(app, { name: '负责人' })
  const teamId = randomUUID()
  const projectId = randomUUID()
  const requirementId = randomUUID()
  const bugId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: ownerUser.userId, role: 'developer', status: 'disabled' },
  ])
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: 'owner-project',
    description: null,
    owner_user_id: ownerUser.userId,
    created_by_user_id: adminUser.userId,
  })
  await app.db.insert(requirement).values({
    id: requirementId,
    team_id: teamId,
    project_id: projectId,
    number: 1,
    title: '需复核需求',
    content_mode: 'markdown',
    content_markdown: '正文',
    dev_owner_user_id: ownerUser.userId,
    test_owner_user_id: ownerUser.userId,
    status: 'passed',
    created_by_user_id: adminUser.userId,
  })
  await app.db.insert(bug).values({
    id: bugId,
    team_id: teamId,
    project_id: projectId,
    number: 1,
    title: '未解决缺陷',
    phenomenon: '现象',
    expected_behavior: '预期',
    reproduction: '复现',
    fix_owner_user_id: ownerUser.userId,
    status: 'in_fix',
    created_by_user_id: adminUser.userId,
  })
  await app.db.insert(bugRequirementLink).values({
    id: randomUUID(),
    team_id: teamId,
    bug_id: bugId,
    requirement_id: requirementId,
    created_by_user_id: adminUser.userId,
  })
  const headers = { cookie: adminUser.cookie }
  const projectDetail = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}`, headers })
  assert.equal(projectDetail.json().data.owner.status, 'disabled')
  assert.equal(projectDetail.json().data.owner.available, false)

  const projectList = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/projects?ownerUnavailable=true`,
    headers,
  })
  assert.equal(projectList.json().data.total, 1)

  const requirementList = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/requirements?ownerUnavailable=true`,
    headers,
  })
  const requirementItem = requirementList.json().data.items[0]
  assert.equal(requirementItem.devOwner.status, 'disabled')
  assert.equal(requirementItem.devOwner.available, false)
  assert.equal(requirementItem.needsReview, true)

  const bugList = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/bugs?ownerUnavailable=true`,
    headers,
  })
  const bugItem = bugList.json().data.items[0]
  assert.equal(bugItem.fixOwner.status, 'disabled')
  assert.equal(bugItem.fixOwner.available, false)

  await app.db
    .update(teamMember)
    .set({ status: 'active' })
    .where(
      (await import('drizzle-orm')).and(
        (await import('drizzle-orm')).eq(teamMember.team_id, teamId),
        (await import('drizzle-orm')).eq(teamMember.user_id, ownerUser.userId),
      ),
    )

  const activeProject = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}`, headers })
  assert.equal(activeProject.json().data.owner.status, 'active')
  assert.equal(activeProject.json().data.owner.available, true)
  const noUnavailable = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/projects?ownerUnavailable=true`,
    headers,
  })
  assert.equal(noUnavailable.json().data.total, 0)
})
