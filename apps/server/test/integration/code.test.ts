import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { team, teamMember } from '../../src/modules/identity/identity.tables.js'
import { project } from '../../src/modules/projects/projects.tables.js'
import { requirement } from '../../src/modules/requirements/requirements.tables.js'
import { bug } from '../../src/modules/bugs/bugs.tables.js'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.js'
import { gitRepository } from '../../src/modules/code/code.tables.js'
import { GitAdapterError, type GitAdapter, type GitObjectSnapshot } from '../../src/adapters/git/git.types.js'
import { createAuthenticatedUser } from '../support/auth.js'
import { FakeMailer } from '../support/fake-mailer.js'

test('项目仓库关联、代码引用创建/刷新/移除、权限、唯一与来源失败', { timeout: 90_000 }, async (t) => {
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
  const connectionId = randomUUID()
  let snapshot: GitObjectSnapshot = {
    objectType: 'issue',
    remoteId: '12',
    title: '登录失败',
    state: 'open',
    url: 'https://example.test/issues/12',
  }
  let failNext = false
  const adapter: GitAdapter = {
    async checkConnection() {
      return { identity: 'fake' }
    },
    async listRepositories() {
      return []
    },
    async getObject() {
      if (failNext) throw new GitAdapterError('auth_failed', '授权失败')
      return { ...snapshot }
    },
  }
  const app = createHttpApp(config, {
    mailer: new FakeMailer(),
    gitAdapterResolver: async (id) => {
      assert.equal(id, connectionId)
      return adapter
    },
    activeConnectionIds: async () => [connectionId],
  })
  cleanup.push(async () => {
    await app.close()
  })

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
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '代码项目',
    owner_user_id: adminUser.userId,
    created_by_user_id: adminUser.userId,
  })
  const requirementId = randomUUID()
  await app.db.insert(requirement).values({
    id: requirementId,
    team_id: teamId,
    project_id: projectId,
    number: 1,
    title: '登录需求',
    content_mode: 'markdown',
    content_markdown: '正文',
    created_by_user_id: adminUser.userId,
  })
  const bugId = randomUUID()
  await app.db.insert(bug).values({
    id: bugId,
    team_id: teamId,
    project_id: projectId,
    number: 1,
    title: '登录 Bug',
    phenomenon: '失败',
    expected_behavior: '成功',
    reproduction: '步骤',
    created_by_user_id: adminUser.userId,
  })
  await app.db.insert(gitConnection).values({
    id: connectionId,
    team_id: teamId,
    provider_key: 'github',
    instance_url: 'https://github.com',
    name: 'GitHub',
    status: 'active',
    auth_kind: 'github_cli',
    created_by_user_id: adminUser.userId,
  })
  const repositoryId = randomUUID()
  await app.db.insert(gitRepository).values({
    id: repositoryId,
    team_id: teamId,
    connection_id: connectionId,
    provider_key: 'github',
    remote_repository_id: 'aiShuiJiaoDeXioShou/dev-ops',
    namespace: 'aiShuiJiaoDeXioShou',
    name: 'dev-ops',
    web_url: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops',
    default_branch: 'main',
  })

  const linked = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/repositories`,
    payload: { repositoryId },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(linked.statusCode, 200, linked.body)
  assert.equal(linked.json().data[0].id, repositoryId)

  const viewerLink = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/repositories`,
    payload: { repositoryId },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerLink.json().code, 'FORBIDDEN')

  const available = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/repositories/available`,
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(available.json().data.total, 1)

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/code-references`,
    payload: { targetType: 'requirement', targetId: requirementId, repositoryId, objectType: 'issue', remoteId: '12' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(created.statusCode, 200, created.body)
  assert.equal(created.json().data.lastCheckStatus, 'ok')
  assert.equal(created.json().data.title, '登录失败')
  const referenceId = created.json().data.id as string

  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/code-references`,
    payload: { targetType: 'requirement', targetId: requirementId, repositoryId, objectType: 'issue', remoteId: '12' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(duplicate.json().code, 'DUPLICATE_RELATION')

  const bugReference = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/code-references`,
    payload: { targetType: 'bug', targetId: bugId, repositoryId, objectType: 'commit', remoteId: 'abcdef1' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(bugReference.json().success, true)
  const requirementDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(requirementDetail.json().data.linkedCodeReferences.length, 1)
  assert.equal(requirementDetail.json().data.linkedCodeReferences[0].remoteId, '12')
  const bugDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/bugs/${bugId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(bugDetail.json().data.linkedCodeReferences.length, 1)

  snapshot = {
    objectType: 'issue',
    remoteId: '12',
    title: '登录失败 v2',
    state: 'closed',
    url: 'https://example.test/issues/12',
  }
  const refreshed = await app.inject({
    method: 'POST',
    url: `/api/v1/code-references/${referenceId}/refresh`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(refreshed.json().data.lastCheckStatus, 'ok')
  assert.equal(refreshed.json().data.state, 'closed')

  failNext = true
  const failed = await app.inject({
    method: 'POST',
    url: `/api/v1/code-references/${referenceId}/refresh`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(failed.json().data.lastCheckStatus, 'auth_failed')
  assert.equal(failed.json().data.lastErrorCode, 'auth_failed')
  assert.equal(failed.json().data.title, null)

  const removed = await app.inject({
    method: 'POST',
    url: `/api/v1/code-references/${referenceId}/remove`,
    payload: { reason: '关联错误' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(removed.json().success, true)

  const unlinked = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/repositories/${repositoryId}/remove`,
    payload: { reason: '仓库迁移' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(unlinked.json().success, true)
  assert.deepEqual(unlinked.json().data, [])
})
