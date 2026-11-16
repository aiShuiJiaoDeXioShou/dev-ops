import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { gitRepository, projectRepository } from '../../src/modules/code/code.tables.ts'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

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

  await t.test('仓库选项去重，列表与晴雨表按仓库筛选后再分页', async () => {
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/projects`,
      payload: { name: '内部平台客户端' },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(second.json().success, true, second.body)
    const secondId = second.json<{ data: { id: string } }>().data.id
    const unrelated = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/projects`,
      payload: { name: '其他项目' },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(unrelated.json().success, true, unrelated.body)

    const connectionId = randomUUID()
    const sharedId = randomUUID()
    const webId = randomUUID()
    await app.db.insert(gitConnection).values({
      id: connectionId,
      team_id: teamId,
      provider_key: 'gitea',
      auth_kind: 'gitea_token',
      instance_url: 'https://git.example.test',
      name: '团队 Gitea',
      created_by_user_id: adminUser.userId,
    })
    await app.db.insert(gitRepository).values(
      [
        { id: sharedId, name: 'core' },
        { id: webId, name: 'web' },
        { id: randomUUID(), name: 'unlinked' },
      ].map(({ id, name }) => ({
        id,
        team_id: teamId,
        connection_id: connectionId,
        provider_key: 'gitea',
        remote_repository_id: name,
        namespace: 'team',
        name,
        web_url: `https://git.example.test/team/${name}`,
      })),
    )
    await app.db.insert(projectRepository).values(
      [
        { projectId: project.id, repositoryId: sharedId },
        { projectId: secondId, repositoryId: sharedId },
        { projectId: secondId, repositoryId: webId },
      ].map(({ projectId, repositoryId }) => ({
        id: randomUUID(),
        team_id: teamId,
        project_id: projectId,
        repository_id: repositoryId,
        created_by_user_id: adminUser.userId,
      })),
    )

    const optionsPath = `/api/v1/teams/${teamId}/project-repositories`
    const options = await app.inject({ url: optionsPath, headers: { cookie: viewerUser.cookie } })
    assert.deepEqual(options.json().data.items, [
      { id: sharedId, namespace: 'team', name: 'core', providerKey: 'gitea', connectionName: '团队 Gitea' },
      { id: webId, namespace: 'team', name: 'web', providerKey: 'gitea', connectionName: '团队 Gitea' },
    ])
    const optionsPage = await app.inject({
      url: `${optionsPath}?page=2&pageSize=1`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(optionsPage.json().data.total, 2)
    assert.equal(optionsPage.json().data.items[0].id, webId)
    const denied = await app.inject({ url: optionsPath, headers: { cookie: otherUser.cookie } })
    assert.equal(denied.json().code, 'FORBIDDEN')

    const filterPath = `/api/v1/teams/${teamId}/projects?repositoryId=${sharedId}`
    const projectIds: string[] = []
    for (const page of [1, 2]) {
      const filtered = await app.inject({
        url: `${filterPath}&page=${page}&pageSize=1`,
        headers: { cookie: viewerUser.cookie },
      })
      const result = filtered.json<{ data: { total: number; items: Array<{ id: string }> } }>().data
      assert.equal(result.total, 2)
      assert.equal(result.items.length, 1)
      projectIds.push(...result.items.map((item) => item.id))
    }
    assert.deepEqual(new Set(projectIds), new Set([project.id, secondId]))
    const paused = await app.inject({
      url: `${filterPath}&status=paused&search=${encodeURIComponent('内部平台')}`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(paused.json().data.total, 1)
    assert.equal(paused.json().data.items[0].id, project.id)
    const dashboard = await app.inject({
      url: `/api/v1/teams/${teamId}/project-activity?repositoryId=${sharedId}&source=activity`,
      headers: { cookie: viewerUser.cookie },
    })
    const summary = dashboard.json<{ data: { projects: Array<{ projectId: string }> } }>().data.projects
    assert.deepEqual(new Set(summary.map((item) => item.projectId)), new Set(projectIds))
  })

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
