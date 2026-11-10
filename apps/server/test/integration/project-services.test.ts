import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { gitRepository, projectRepository } from '../../src/modules/code/code.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('服务目录：创建、仓库映射、重名、停用、版本冲突与权限', { timeout: 90_000 }, async (t) => {
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
  const viewerUser = await createAuthenticatedUser(app, { name: '浏览者' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
  ])
  const projectResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '服务目录项目' },
    headers: { cookie: adminUser.cookie },
  })
  const projectId = projectResponse.json().data.id as string
  const repositoryId = randomUUID()
  await app.db.insert(gitRepository).values({
    id: repositoryId,
    team_id: teamId,
    connection_id: randomUUID(),
    provider_key: 'github',
    remote_repository_id: 'repo-1',
    namespace: 'ns',
    name: 'web',
    web_url: 'https://example.test/ns/web',
    status: 'available',
  })
  await app.db.insert(projectRepository).values({
    id: randomUUID(),
    team_id: teamId,
    project_id: projectId,
    repository_id: repositoryId,
    created_by_user_id: adminUser.userId,
  })

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/services`,
    payload: { name: 'Web 前端', description: '站点', repositoryIds: [repositoryId] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(created.json().success, true, created.body)
  const service = created.json().data
  assert.equal(service.name, 'Web 前端')
  assert.equal(service.repositories.length, 1)
  assert.equal(service.repositories[0].repositoryId, repositoryId)
  assert.equal(service.version, 1)

  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/services`,
    payload: { name: 'Web 前端' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(duplicate.json().code, 'SERVICE_NAME_DUPLICATE')

  const viewerCreate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/services`,
    payload: { name: '浏览者服务' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const updated = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/services/${service.id}/update`,
    payload: { version: 1, status: 'disabled' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updated.json().success, true, updated.body)
  assert.equal(updated.json().data.status, 'disabled')
  assert.equal(updated.json().data.version, 2)

  const stale = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/services/${service.id}/update`,
    payload: { version: 1, name: '旧版本' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(stale.json().code, 'VERSION_CONFLICT')

  const addRepository = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/services/${service.id}/repositories`,
    payload: { repositoryId },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(addRepository.json().code, 'DUPLICATE_RELATION')

  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/services`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(list.json().data.length, 1)
  assert.equal(list.json().data[0].repositories.length, 1)
})
