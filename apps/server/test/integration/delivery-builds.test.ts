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

test('构建上报、幂等、产物、事项关联、更正、权限与列表筛选', { timeout: 90_000 }, async (t) => {
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
    payload: { name: '交付测试项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(projectResponse.json().success, true, projectResponse.body)
  const projectId = projectResponse.json().data.id as string
  const requirementResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: { title: '需求一', contentMode: 'markdown', contentMarkdown: '正文' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(requirementResponse.json().success, true, requirementResponse.body)
  const requirementId = requirementResponse.json().data.id as string

  const buildBody = {
    versionLabel: '1.0.0',
    commitRef: 'abc1234',
    source: 'pipeline',
    sourceRunId: 'run-1',
    buildKey: 'ci-100',
    collectedAt: new Date().toISOString(),
    resultStatus: 'succeeded',
    note: '第一次构建',
    artifacts: [
      { artifactType: 'web_test_url', accessUrl: 'https://test.example.test/app' },
      { artifactType: 'mini_program_qr', accessUrl: 'https://test.example.test/qr.png' },
    ],
    targets: [{ targetType: 'requirement', targetId: requirementId }],
  }
  const report = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: buildBody,
    headers: { cookie: devUser.cookie },
  })
  assert.equal(report.statusCode, 200, report.body)
  const build = report.json().data
  assert.equal(report.json().success, true)
  assert.equal(build.buildKey, 'ci-100')
  assert.equal(build.artifacts.length, 2)
  assert.equal(build.targets.length, 1)
  assert.equal(build.version, 1)

  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: buildBody,
    headers: { cookie: devUser.cookie },
  })
  assert.equal(duplicate.json().data.id, build.id)
  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/builds?resultStatus=succeeded`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(list.json().data.total, 1)

  const viewerReport = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: { ...buildBody, buildKey: 'ci-101' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerReport.json().code, 'FORBIDDEN')

  const invalidArtifact = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: {
      ...buildBody,
      buildKey: 'ci-102',
      artifacts: [{ artifactType: 'mobile_package', accessUrl: 'file:///tmp/a.apk' }],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(invalidArtifact.json().code, 'VALIDATION_ERROR')

  const noArtifactNoNote = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: { ...buildBody, buildKey: 'ci-103', artifacts: [], note: null },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(noArtifactNoNote.json().code, 'VALIDATION_ERROR')

  const corrected = await app.inject({
    method: 'POST',
    url: `/api/v1/builds/${build.id}/correct`,
    payload: { version: 1, resultStatus: 'failed', reason: '实际构建失败' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(corrected.json().success, true, corrected.body)
  assert.equal(corrected.json().data.resultStatus, 'failed')
  assert.equal(corrected.json().data.version, 2)
  assert.equal(corrected.json().data.corrections.length, 1)

  const staleCorrect = await app.inject({
    method: 'POST',
    url: `/api/v1/builds/${build.id}/correct`,
    payload: { version: 1, note: '旧版本', reason: '并发' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(staleCorrect.json().code, 'VERSION_CONFLICT')

  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/builds/${build.id}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(detail.json().data.corrections.length, 1)
  assert.equal(detail.json().data.targets[0].title, '需求一')

  const linked = await app.inject({
    method: 'POST',
    url: `/api/v1/builds/${build.id}/targets`,
    payload: { targetType: 'requirement', targetId: requirementId },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(linked.json().code, 'DUPLICATE_RELATION')
})
