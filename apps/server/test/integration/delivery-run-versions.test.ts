import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { projectService } from '../../src/modules/projects/projects.tables.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('服务运行版本：未知/待核对、确认与更正、乐观锁、多服务多环境与停用限制', { timeout: 90_000 }, async (t) => {
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
    payload: { name: '运行版本测试项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(projectResponse.json().success, true, projectResponse.body)
  const projectId = projectResponse.json().data.id as string
  const otherProjectResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '其他项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(otherProjectResponse.json().success, true, otherProjectResponse.body)
  const otherProjectId = otherProjectResponse.json().data.id as string

  const serviceAId = randomUUID()
  const serviceBId = randomUUID()
  const foreignServiceId = randomUUID()
  await app.db.insert(projectService).values([
    {
      id: serviceAId,
      team_id: teamId,
      project_id: projectId,
      name: '前端站点',
      status: 'active',
      created_by_user_id: adminUser.userId,
    },
    {
      id: serviceBId,
      team_id: teamId,
      project_id: projectId,
      name: '后端接口',
      status: 'active',
      created_by_user_id: adminUser.userId,
    },
    {
      id: foreignServiceId,
      team_id: teamId,
      project_id: otherProjectId,
      name: '其他项目服务',
      status: 'active',
      created_by_user_id: adminUser.userId,
    },
  ])

  const runVersionsUrl = (serviceId: string) => `/api/v1/projects/${projectId}/services/${serviceId}/run-versions`
  const confirmUrl = (serviceId: string, environment: string) => `${runVersionsUrl(serviceId)}/${environment}/confirm`

  const initial = await app.inject({
    method: 'GET',
    url: runVersionsUrl(serviceAId),
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(initial.json().success, true, initial.body)
  const initialItems = initial.json().data.items
  assert.deepEqual(
    initialItems.map((item: { environment: string }) => item.environment),
    ['development', 'test', 'production'],
  )
  for (const item of initialItems) {
    assert.equal(item.verificationStatus, 'unknown')
    assert.equal(item.versionLabel, null)
    assert.equal(item.version, 0)
    assert.equal(item.updatedAt, null)
  }

  // 首次确认：无记录时乐观锁期望版本为 0。
  const confirmed = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'test'),
    payload: {
      versionLabel: '1.0.0',
      source: 'manual',
      evidenceUrl: 'https://evidence.example.test/release-1',
      verificationStatus: 'confirmed',
      version: 0,
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(confirmed.json().success, true, confirmed.body)
  assert.equal(confirmed.json().data.versionLabel, '1.0.0')
  assert.equal(confirmed.json().data.verificationStatus, 'confirmed')
  assert.equal(confirmed.json().data.version, 1)
  assert.equal(confirmed.json().data.confirmedBy, devUser.userId)
  assert.ok(confirmed.json().data.confirmedAt)

  // 新构建不自动覆盖运行版本。
  const build = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: {
      serviceId: serviceAId,
      environment: 'test',
      buildKey: 'ci-run-version-1',
      versionLabel: '9.9.9',
      source: 'pipeline',
      collectedAt: new Date().toISOString(),
      resultStatus: 'succeeded',
      note: '新构建',
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(build.json().success, true, build.body)
  const afterBuild = await app.inject({
    method: 'GET',
    url: runVersionsUrl(serviceAId),
    headers: { cookie: devUser.cookie },
  })
  const testEnvironment = afterBuild
    .json()
    .data.items.find((item: { environment: string }) => item.environment === 'test')
  assert.equal(testEnvironment.versionLabel, '1.0.0')
  assert.equal(testEnvironment.version, 1)

  const stale = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'test'),
    payload: { versionLabel: '1.0.1', source: 'manual', verificationStatus: 'confirmed', version: 0 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(stale.json().code, 'VERSION_CONFLICT')

  const missingVersion = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'test'),
    payload: { versionLabel: '1.0.1', source: 'manual', verificationStatus: 'confirmed' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(missingVersion.json().code, 'VERSION_CONFLICT')

  const correctionWithoutReason = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'test'),
    payload: { versionLabel: '1.0.1', source: 'manual', verificationStatus: 'confirmed', version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(correctionWithoutReason.json().code, 'VALIDATION_ERROR')

  const corrected = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'test'),
    payload: {
      versionLabel: '1.0.1',
      source: 'deployment_receipt',
      verificationStatus: 'confirmed',
      version: 1,
      reason: '实际发布版本为 1.0.1',
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(corrected.json().success, true, corrected.body)
  assert.equal(corrected.json().data.version, 2)
  assert.equal(corrected.json().data.versionLabel, '1.0.1')

  const history = await app.inject({
    method: 'GET',
    url: `${runVersionsUrl(serviceAId)}/test/history`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(history.json().success, true, history.body)
  assert.equal(history.json().data.total, 2)
  const latestChange = history.json().data.items[0]
  assert.equal(latestChange.previousVersionLabel, '1.0.0')
  assert.equal(latestChange.newVersionLabel, '1.0.1')
  assert.equal(latestChange.newStatus, 'confirmed')
  assert.equal(latestChange.reason, '实际发布版本为 1.0.1')
  assert.equal(latestChange.changedBy, devUser.userId)

  const viewerConfirm = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'test'),
    payload: { versionLabel: '2.0.0', source: 'manual', verificationStatus: 'confirmed', version: 2 },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerConfirm.json().code, 'FORBIDDEN')

  // 多服务多环境互不影响。
  const serviceBInitial = await app.inject({
    method: 'GET',
    url: runVersionsUrl(serviceBId),
    headers: { cookie: devUser.cookie },
  })
  assert.ok(
    serviceBInitial.json().data.items.every((item: { versionLabel: string | null }) => item.versionLabel === null),
  )
  const serviceBProduction = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceBId, 'production'),
    payload: { versionLabel: '2.0.0', source: 'manual', verificationStatus: 'confirmed', version: 0 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(serviceBProduction.json().success, true)
  const serviceAAfterB = await app.inject({
    method: 'GET',
    url: runVersionsUrl(serviceAId),
    headers: { cookie: viewerUser.cookie },
  })
  const aTest = serviceAAfterB.json().data.items.find((item: { environment: string }) => item.environment === 'test')
  const aProduction = serviceAAfterB
    .json()
    .data.items.find((item: { environment: string }) => item.environment === 'production')
  assert.equal(aTest.versionLabel, '1.0.1')
  assert.equal(aProduction.versionLabel, null)

  // 待核对/未知状态可记录，且不伪造确认人。
  const pending = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'development'),
    payload: { versionLabel: '0.0.0-dev', source: 'manual', verificationStatus: 'pending', version: 0 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(pending.json().success, true, pending.body)
  assert.equal(pending.json().data.verificationStatus, 'pending')
  assert.equal(pending.json().data.confirmedBy, null)
  const unknown = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'development'),
    payload: { versionLabel: '0.0.0-dev', source: 'manual', verificationStatus: 'unknown', version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(unknown.json().success, true, unknown.body)
  assert.equal(unknown.json().data.verificationStatus, 'unknown')

  const invalidEnvironment = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceAId, 'staging'),
    payload: { versionLabel: '1.0.0', source: 'manual', verificationStatus: 'confirmed', version: 2 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(invalidEnvironment.json().code, 'VALIDATION_ERROR')

  const foreignService = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/services/${foreignServiceId}/run-versions`,
    headers: { cookie: devUser.cookie },
  })
  assert.equal(foreignService.json().code, 'NOT_FOUND')

  // 并发首次确认：唯一约束与条件更新共同保证只有一个成功。
  const parallelUrl = confirmUrl(serviceAId, 'production')
  const parallelPayload = {
    versionLabel: '3.0.0',
    source: 'manual',
    verificationStatus: 'confirmed',
    version: 0,
  }
  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: parallelUrl, payload: parallelPayload, headers: { cookie: devUser.cookie } }),
    app.inject({ method: 'POST', url: parallelUrl, payload: parallelPayload, headers: { cookie: devUser.cookie } }),
  ])
  const results = [first, second].map((response) => ({ success: response.json().success, code: response.json().code }))
  assert.equal(results.filter((result) => result.success).length, 1)
  assert.equal(results.filter((result) => result.code === 'VERSION_CONFLICT').length, 1)

  // 停用服务保留只读历史，但拒绝新的确认动作。
  await app.db
    .update(projectService)
    .set({ status: 'disabled', updated_at: new Date() })
    .where(eq(projectService.id, serviceBId))
  const disabledRead = await app.inject({
    method: 'GET',
    url: runVersionsUrl(serviceBId),
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(disabledRead.json().success, true)
  const disabledConfirm = await app.inject({
    method: 'POST',
    url: confirmUrl(serviceBId, 'test'),
    payload: { versionLabel: '2.0.1', source: 'manual', verificationStatus: 'confirmed', version: 0 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(disabledConfirm.json().code, 'PRECONDITION_FAILED')
})
