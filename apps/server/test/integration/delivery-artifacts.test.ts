import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { buildArtifact } from '../../src/modules/delivery/delivery.tables.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { projectService } from '../../src/modules/projects/projects.tables.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('项目产物入口：最新与历史、服务/环境/类型筛选、权限与失效状态', { timeout: 90_000 }, async (t) => {
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
  const outsiderUser = await createAuthenticatedUser(app, { name: '外部成员' })
  const teamId = randomUUID()
  const otherTeamId = randomUUID()
  await app.db.insert(team).values([
    { id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId },
    { id: otherTeamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: outsiderUser.userId },
  ])
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
    { id: randomUUID(), team_id: otherTeamId, user_id: outsiderUser.userId, role: 'admin', status: 'active' },
  ])
  const projectResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '产物测试项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(projectResponse.json().success, true, projectResponse.body)
  const projectId = projectResponse.json().data.id as string
  const emptyProjectResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '空产物项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(emptyProjectResponse.json().success, true, emptyProjectResponse.body)
  const emptyProjectId = emptyProjectResponse.json().data.id as string
  const serviceId = randomUUID()
  await app.db.insert(projectService).values({
    id: serviceId,
    team_id: teamId,
    project_id: projectId,
    name: '前端站点',
    status: 'active',
    created_by_user_id: adminUser.userId,
  })

  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  async function reportBuild(input: {
    buildKey: string
    serviceId?: string
    environment?: string
    collectedAt: string
    artifacts: Array<{ artifactType: string; accessUrl: string }>
  }) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/builds`,
      payload: {
        buildKey: input.buildKey,
        versionLabel: `v-${input.buildKey}`,
        source: 'pipeline',
        collectedAt: input.collectedAt,
        resultStatus: 'succeeded',
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        artifacts: input.artifacts.map((artifact) => ({ ...artifact, collectedAt: input.collectedAt })),
      },
      headers: { cookie: devUser.cookie },
    })
    assert.equal(response.json().success, true, response.body)
    return response.json().data
  }

  const oldest = minutesAgo(30)
  const middle = minutesAgo(20)
  const newest = minutesAgo(10)
  const buildA = await reportBuild({
    buildKey: 'ci-artifact-a',
    serviceId,
    environment: 'test',
    collectedAt: oldest,
    artifacts: [
      { artifactType: 'web_test_url', accessUrl: 'https://test.example.test/a' },
      { artifactType: 'mobile_package', accessUrl: 'https://test.example.test/a.apk' },
      { artifactType: 'mini_program_qr', accessUrl: 'https://test.example.test/a-qr.png' },
    ],
  })
  const buildB = await reportBuild({
    buildKey: 'ci-artifact-b',
    serviceId,
    environment: 'test',
    collectedAt: middle,
    artifacts: [{ artifactType: 'web_test_url', accessUrl: 'https://test.example.test/b' }],
  })
  await reportBuild({
    buildKey: 'ci-artifact-c',
    collectedAt: oldest,
    artifacts: [{ artifactType: 'mobile_package', accessUrl: 'https://test.example.test/c.apk' }],
  })
  await reportBuild({
    buildKey: 'ci-artifact-d',
    serviceId,
    environment: 'production',
    collectedAt: newest,
    artifacts: [{ artifactType: 'web_test_url', accessUrl: 'https://test.example.test/d' }],
  })

  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(history.json().success, true, history.body)
  const historyData = history.json().data
  assert.equal(historyData.total, 6)
  assert.equal(historyData.items.length, 6)
  const webA = historyData.items.find(
    (item: { buildId: string; artifactType: string }) =>
      item.buildId === buildA.id && item.artifactType === 'web_test_url',
  )
  const webB = historyData.items.find(
    (item: { buildId: string; artifactType: string }) =>
      item.buildId === buildB.id && item.artifactType === 'web_test_url',
  )
  assert.equal(webA.isLatest, false)
  assert.equal(webB.isLatest, true)
  const productionWeb = historyData.items.find(
    (item: { environment: string | null; artifactType: string }) =>
      item.environment === 'production' && item.artifactType === 'web_test_url',
  )
  assert.equal(productionWeb.isLatest, true)
  assert.equal(productionWeb.serviceId, serviceId)
  const collectedTimes = historyData.items.map((item: { collectedAt: string }) => item.collectedAt)
  assert.deepEqual(collectedTimes, [...collectedTimes].sort().reverse())

  const latest = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts?latest=true`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(latest.json().data.total, 5)
  assert.ok(
    latest.json().data.items.every((item: { isLatest: boolean }) => item.isLatest),
    '最新模式返回的每条都必须标记为最新',
  )

  const scoped = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts?latest=true&serviceId=${serviceId}&environment=test&artifactType=web_test_url`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(scoped.json().data.total, 1)
  assert.equal(scoped.json().data.items[0].accessUrl, 'https://test.example.test/b')

  const byService = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts?serviceId=${serviceId}&page=1&pageSize=2`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(byService.json().data.total, 5)
  assert.equal(byService.json().data.items.length, 2)
  assert.equal(byService.json().data.pageSize, 2)

  const byEnvironment = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts?environment=production`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(byEnvironment.json().data.total, 1)

  // 失效产物显式标记，不隐藏也不冒充最新有效。
  const artifactId = webB.id as string
  await app.db
    .update(buildArtifact)
    .set({ status: 'expired', updated_at: new Date() })
    .where(eq(buildArtifact.id, artifactId))
  const expired = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts?latest=true&artifactType=web_test_url&serviceId=${serviceId}&environment=test`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(expired.json().data.items[0].status, 'expired')

  const empty = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${emptyProjectId}/artifacts`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(empty.json().success, true)
  assert.equal(empty.json().data.total, 0)
  assert.deepEqual(empty.json().data.items, [])

  const outsider = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/artifacts`,
    headers: { cookie: outsiderUser.cookie },
  })
  assert.equal(outsider.json().success, false)
  assert.equal(outsider.json().code, 'FORBIDDEN')

  const anonymous = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/artifacts` })
  assert.equal(anonymous.json().code, 'UNAUTHENTICATED')
})
