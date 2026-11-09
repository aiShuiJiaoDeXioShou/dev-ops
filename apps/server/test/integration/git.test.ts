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
import { requirement } from '../../src/modules/requirements/requirements.tables.js'
import { gitRepository } from '../../src/modules/code/code.tables.js'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.js'
import type { GitAdapter } from '../../src/adapters/git/git.types.js'
import { createAuthenticatedUser } from '../support/auth.js'
import { FakeMailer } from '../support/fake-mailer.js'

test('Git 连接创建、检查、同步、仓库关联、代码引用、撤权与凭据加密', { timeout: 90_000 }, async (t) => {
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

  const encryptionKey = Buffer.alloc(32, 9).toString('base64')
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GIT_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    GITHUB_AUTH_MODE: 'cli',
    GITHUB_ALLOWED_REPOS: 'aiShuiJiaoDeXioShou/dev-ops',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '1000',
    DB_LOCK_TIMEOUT_MS: '100',
  })
  const repositories = [
    {
      remoteId: 'aiShuiJiaoDeXioShou/dev-ops',
      namespace: 'aiShuiJiaoDeXioShou',
      name: 'dev-ops',
      webUrl: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops',
      defaultBranch: 'main',
    },
  ]
  let calls = 0
  const adapter: GitAdapter = {
    async checkConnection() {
      calls += 1
      return { identity: 'aiShuiJiaoDeXioShou' }
    },
    async listRepositories() {
      calls += 1
      return repositories
    },
    async getObject() {
      calls += 1
      return {
        objectType: 'issue',
        remoteId: '1',
        title: '远端问题',
        state: 'open',
        url: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops/issues/1',
      }
    },
  }
  const app = createHttpApp(config, {
    mailer: new FakeMailer(),
    gitAdapterFactory: async () => adapter,
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

  const providers = await app.inject({
    method: 'GET',
    url: '/api/v1/git-providers',
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(providers.json().success, true)
  assert.equal(providers.json().data.length, 2)

  const viewerCreate = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/git-connections`,
    payload: { providerKey: 'gitea', name: 'Gitea', instanceUrl: 'https://gitea.example.test', token: 'secret-token' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/git-connections`,
    payload: {
      providerKey: 'gitea',
      name: 'Gitea 生产',
      instanceUrl: 'https://gitea.example.test',
      token: 'secret-token-value',
    },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(created.statusCode, 200, created.body)
  const connection = created.json().data
  assert.equal(connection.providerKey, 'gitea')
  assert.equal(connection.status, 'active')
  assert.equal(calls >= 2, true)

  const listed = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/git-connections`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(listed.json().data.length, 1)
  assert.equal(JSON.stringify(listed.json()).includes('secret-token-value'), false)

  const repoList = await app.inject({
    method: 'GET',
    url: `/api/v1/git-connections/${connection.id}/repositories`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(repoList.json().data.total, 1)
  const repositoryId = repoList.json().data.items[0].id as string

  const checked = await app.inject({
    method: 'POST',
    url: `/api/v1/git-connections/${connection.id}/check`,
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(checked.json().data.status, 'active')
  const synced = await app.inject({
    method: 'POST',
    url: `/api/v1/git-connections/${connection.id}/sync-repositories`,
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(synced.json().data.synced, 1)

  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: 'Git 项目',
    owner_user_id: adminUser.userId,
    created_by_user_id: adminUser.userId,
  })
  const requirementId = randomUUID()
  await app.db.insert(requirement).values({
    id: requirementId,
    team_id: teamId,
    project_id: projectId,
    number: 1,
    title: 'Git 需求',
    content_mode: 'markdown',
    content_markdown: '正文',
    created_by_user_id: adminUser.userId,
  })
  const linked = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/repositories`,
    payload: { repositoryId },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(linked.json().success, true, linked.body)
  const duplicateLink = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/repositories`,
    payload: { repositoryId },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(duplicateLink.json().code, 'DUPLICATE_RELATION')
  const syncAgain = await app.inject({
    method: 'POST',
    url: `/api/v1/git-connections/${connection.id}/sync-repositories`,
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(syncAgain.json().data.synced, 1)
  const remoteRows = await app.db.select({ id: gitRepository.id }).from(gitRepository)
  assert.equal(remoteRows.length, 1)
  const reference = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/code-references`,
    payload: { targetType: 'requirement', targetId: requirementId, repositoryId, objectType: 'issue', remoteId: '1' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(reference.json().data.lastCheckStatus, 'ok', reference.body)

  const stored = await app.db.execute<{ ciphertext: string }>(sql`SELECT ciphertext FROM app.secret`)
  assert.ok(stored.rows[0]?.ciphertext)
  assert.equal(stored.rows[0].ciphertext.includes('secret-token-value'), false)

  const revoked = await app.inject({
    method: 'POST',
    url: `/api/v1/git-connections/${connection.id}/revoke`,
    payload: { reason: '授权收回' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(revoked.json().data.status, 'revoked')
  const repoAfter = await app.db.select({ status: gitRepository.status }).from(gitRepository)
  assert.equal(
    repoAfter.every((row) => row.status === 'removed'),
    true,
  )

  const noFks = await app.db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'app' AND c.contype = 'f'
  `)
  assert.equal(noFks.rows[0]?.count, 0)
  void gitConnection
})
