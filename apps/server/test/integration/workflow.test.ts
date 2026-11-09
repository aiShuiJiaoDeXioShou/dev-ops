import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { team, teamMember } from '../../src/modules/identity/identity.tables.js'
import { project } from '../../src/modules/projects/projects.tables.js'
import { createAuthenticatedUser } from '../support/auth.js'
import { FakeMailer } from '../support/fake-mailer.js'

test('需求提测、测试、Bug 阻碍、通过复核、取消恢复与版本冲突', { timeout: 90_000 }, async (t) => {
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
  const viewerUser = await createAuthenticatedUser(app, { name: '测试者' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'developer', status: 'active' },
  ])
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '流程项目',
    owner_user_id: adminUser.userId,
    created_by_user_id: adminUser.userId,
  })

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '流程需求',
      contentMode: 'markdown',
      contentMarkdown: '正文',
      devOwnerUserId: devUser.userId,
      testOwnerUserId: viewerUser.userId,
    },
    headers: { cookie: adminUser.cookie },
  })
  let requirementRow = created.json().data
  const requirementId = requirementRow.id as string

  const viewerStart = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/start-development`,
    payload: { version: requirementRow.version },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerStart.json().data.status, 'in_development', viewerStart.body)
  requirementRow = viewerStart.json().data
  let response = viewerStart

  const submit = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/submit-test`,
    payload: {
      version: requirementRow.version,
      testOwnerUserId: viewerUser.userId,
      scopeNote: '登录流程',
      selfTestResult: 'passed',
      testEntry: 'https://example.test/login',
      versionNote: 'v1',
    },
    headers: { cookie: devUser.cookie, 'idempotency-key': 'submit-test-1' },
  })
  assert.equal(submit.statusCode, 200, submit.body)
  assert.equal(submit.json().data.requirement.status, 'submitted')
  assert.equal(submit.json().data.submission.selfTestResult, 'passed')
  assert.ok(submit.json().data.activityId)
  requirementRow = submit.json().data.requirement

  const duplicateSubmit = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/submit-test`,
    payload: {
      version: requirementRow.version - 1,
      testOwnerUserId: viewerUser.userId,
      scopeNote: '登录流程',
      selfTestResult: 'passed',
      testEntry: 'https://example.test/login',
      versionNote: 'v1',
    },
    headers: { cookie: devUser.cookie, 'idempotency-key': 'submit-test-1' },
  })
  assert.equal(duplicateSubmit.json().code, 'IDEMPOTENCY_CONFLICT')

  response = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/start-test`,
    payload: { version: requirementRow.version },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(response.json().data.status, 'in_testing', response.body)
  requirementRow = response.json().data

  const bugCreated = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: {
      title: '登录失败',
      phenomenon: '无法登录',
      expectedBehavior: '登录成功',
      reproduction: '步骤',
      fixOwnerUserId: devUser.userId,
      requirementIds: [requirementId],
    },
    headers: { cookie: devUser.cookie },
  })
  let bugRow = bugCreated.json().data

  let eligibility = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}/test-pass-eligibility`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(eligibility.json().data.eligible, false)
  assert.equal(eligibility.json().data.blockers.length, 1)

  const blocked = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/pass-test`,
    payload: { version: requirementRow.version, conclusion: '测试通过' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(blocked.json().success, false)
  assert.equal(blocked.json().code, 'PRECONDITION_FAILED')
  assert.equal(blocked.json().data.blockers[0].id, bugRow.id)

  const startFix = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugRow.id}/start-fix`,
    payload: { version: bugRow.version },
    headers: { cookie: devUser.cookie },
  })
  bugRow = startFix.json().data
  const submitted = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugRow.id}/submit-regression`,
    payload: { version: bugRow.version, fixSummary: '修复登录', verifierUserId: viewerUser.userId },
    headers: { cookie: devUser.cookie },
  })
  bugRow = submitted.json().data.bug
  const passed = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugRow.id}/record-regression`,
    payload: { version: bugRow.version, result: 'passed', note: '回归通过' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(passed.json().data.status, 'resolved', passed.body)
  bugRow = passed.json().data

  eligibility = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}/test-pass-eligibility`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(eligibility.json().data.eligible, true)

  const testPass = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/pass-test`,
    payload: { version: requirementRow.version, conclusion: '测试通过' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(testPass.json().data.status, 'passed', testPass.body)
  requirementRow = testPass.json().data
  assert.equal(requirementRow.latestTestSubmission.selfTestResult, 'passed')
  assert.equal(requirementRow.needsReview, false)

  // 通过后重开 Bug，需求详情出现复核提示。
  const reopenedBug = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugRow.id}/reopen`,
    payload: { version: bugRow.version, reason: '线上复现' },
    headers: { cookie: devUser.cookie },
  })
  bugRow = reopenedBug.json().data
  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(detail.json().data.needsReview, true)
  assert.equal(detail.json().data.linkedBugs[0].status, 'pending')

  const submissions = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}/test-submissions`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(submissions.json().data.total, 1)

  const conflict = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/reopen-development`,
    payload: { version: 1, reason: '旧版本' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(conflict.json().code, 'VERSION_CONFLICT')

  const reopenDev = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/reopen-development`,
    payload: { version: requirementRow.version, reason: '存在复核项' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(reopenDev.json().data.status, 'in_development')
  requirementRow = reopenDev.json().data

  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/cancel`,
    payload: { version: requirementRow.version, reason: '不再需要' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(cancelled.json().data.status, 'cancelled')
  requirementRow = cancelled.json().data

  const restored = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/restore`,
    payload: { version: requirementRow.version, reason: '恢复处理' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(restored.json().data.status, 'pending')

  // 第二条需求验证撤回测试与退回开发。
  const second = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '第二需求',
      contentMode: 'markdown',
      contentMarkdown: '正文',
      devOwnerUserId: devUser.userId,
      testOwnerUserId: viewerUser.userId,
    },
    headers: { cookie: adminUser.cookie },
  })
  let secondRow = second.json().data
  const startSecond = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${secondRow.id}/start-development`,
    payload: { version: secondRow.version },
    headers: { cookie: devUser.cookie },
  })
  secondRow = startSecond.json().data
  const submitSecond = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${secondRow.id}/submit-test`,
    payload: {
      version: secondRow.version,
      testOwnerUserId: viewerUser.userId,
      scopeNote: '范围',
      selfTestResult: 'has_failures',
      selfTestNote: '部分失败',
    },
    headers: { cookie: devUser.cookie },
  })
  secondRow = submitSecond.json().data.requirement
  const withdraw = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${secondRow.id}/withdraw-test`,
    payload: { version: secondRow.version, reason: '补充自测' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(withdraw.json().data.status, 'in_development')
  secondRow = withdraw.json().data
  const submitSecondAgain = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${secondRow.id}/submit-test`,
    payload: {
      version: secondRow.version,
      testOwnerUserId: viewerUser.userId,
      scopeNote: '范围',
      selfTestResult: 'passed',
    },
    headers: { cookie: devUser.cookie },
  })
  secondRow = submitSecondAgain.json().data.requirement
  const startSecondTest = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${secondRow.id}/start-test`,
    payload: { version: secondRow.version },
    headers: { cookie: viewerUser.cookie },
  })
  secondRow = startSecondTest.json().data
  const returned = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${secondRow.id}/return-to-development`,
    payload: { version: secondRow.version, reason: '发现缺陷' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(returned.json().data.status, 'in_development')
})
