import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { requirement } from '../../src/modules/requirements/requirements.tables.ts'
import { bugRegression as bugRegressionTable } from '../../src/modules/bugs/bugs.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('Bug 完整状态机、回归历史、关联、关闭重开、计数与权限', { timeout: 90_000 }, async (t) => {
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
  const otherProjectId = randomUUID()
  await app.db.insert(project).values([
    {
      id: projectId,
      team_id: teamId,
      name: 'Bug 项目',
      owner_user_id: adminUser.userId,
      created_by_user_id: adminUser.userId,
    },
    {
      id: otherProjectId,
      team_id: otherTeamId,
      name: '其他项目',
      owner_user_id: otherUser.userId,
      created_by_user_id: otherUser.userId,
    },
  ])
  const requirementId = randomUUID()
  const otherProjectRequirementId = randomUUID()
  await app.db.insert(requirement).values([
    {
      id: requirementId,
      team_id: teamId,
      project_id: projectId,
      number: 1,
      title: '关联需求',
      content_mode: 'markdown',
      content_markdown: '正文',
      created_by_user_id: adminUser.userId,
    },
    {
      id: otherProjectRequirementId,
      team_id: otherTeamId,
      project_id: otherProjectId,
      number: 1,
      title: '跨项目需求',
      content_mode: 'markdown',
      content_markdown: '正文',
      created_by_user_id: otherUser.userId,
    },
  ])

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: {
      title: '登录闪退',
      phenomenon: '点击登录闪退',
      expectedBehavior: '正常进入首页',
      reproduction: '1. 打开登录页\n2. 点击登录',
      fixOwnerUserId: devUser.userId,
      requirementIds: [requirementId],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(created.statusCode, 200, created.body)
  const createdBody = created.json()
  assert.equal(createdBody.success, true)
  assert.equal(createdBody.data.number, 1)
  assert.equal(createdBody.data.status, 'pending')
  assert.equal(createdBody.data.fixOwner.userId, devUser.userId)
  assert.equal(createdBody.data.linkedRequirements[0].id, requirementId)
  let bug = createdBody.data

  const unknownRepro = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: { title: '偶现', phenomenon: '偶现', expectedBehavior: '稳定', reproductionUnknown: true },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(unknownRepro.json().success, true)
  assert.equal(unknownRepro.json().data.reproductionUnknown, true)

  const viewerCreate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: { title: '浏览者', phenomenon: 'x', expectedBehavior: 'y', reproduction: 'z' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const invalidLink = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/requirements`,
    payload: { version: bug.version, requirementId: otherProjectRequirementId },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(invalidLink.json().code, 'PRECONDITION_FAILED')

  const duplicateLink = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/requirements`,
    payload: { version: bug.version, requirementId },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(duplicateLink.json().code, 'DUPLICATE_RELATION')

  const startFix = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/start-fix`,
    payload: { version: bug.version },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(startFix.json().data.status, 'in_fix', startFix.body)
  bug = startFix.json().data

  const staleUpdate = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/update`,
    payload: { version: 1, title: '旧版本' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(staleUpdate.json().code, 'VERSION_CONFLICT')

  const submit = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/submit-regression`,
    payload: { version: bug.version, fixSummary: '修复登录状态', verifierUserId: viewerUser.userId },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(submit.statusCode, 200, submit.body)
  assert.equal(submit.json().data.bug.status, 'in_regression')
  assert.equal(submit.json().data.regression.attempt, 1)
  assert.ok(submit.json().data.activityId)
  bug = submit.json().data.bug

  const frozen = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/update`,
    payload: { version: bug.version, title: '不允许改' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(frozen.json().code, 'INVALID_TRANSITION')

  const withdraw = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/withdraw-regression`,
    payload: { version: bug.version, reason: '需要补充修复' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(withdraw.json().data.status, 'in_fix')
  bug = withdraw.json().data

  const submitAgain = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/submit-regression`,
    payload: { version: bug.version, fixSummary: '补充修复', verifierUserId: viewerUser.userId },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(submitAgain.json().data.regression.attempt, 2)
  bug = submitAgain.json().data.bug

  const failed = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/record-regression`,
    payload: { version: bug.version, result: 'failed', note: '仍会闪退' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(failed.json().data.status, 'in_fix', failed.body)
  bug = failed.json().data

  const submitThird = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/submit-regression`,
    payload: { version: bug.version, fixSummary: '最终修复', verifierUserId: viewerUser.userId },
    headers: { cookie: devUser.cookie },
  })
  bug = submitThird.json().data.bug
  const passed = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/record-regression`,
    payload: { version: bug.version, result: 'passed', note: '回归通过' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(passed.json().data.status, 'resolved', passed.body)
  assert.equal(passed.json().data.regressions.length, 3)
  assert.equal(passed.json().data.regressions[0].result, 'passed')
  bug = passed.json().data

  const statsResolved = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/stats`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(statsResolved.json().data.openBugs, 1) // 另一条偶现 Bug 仍未解决

  const reopen = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/reopen`,
    payload: { version: bug.version, reason: '线上复现' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(reopen.json().data.status, 'pending')
  bug = reopen.json().data

  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: { title: '重复问题', phenomenon: '重复', expectedBehavior: '不同', reproduction: '步骤' },
    headers: { cookie: adminUser.cookie },
  })
  const duplicateBug = duplicate.json().data
  const closed = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/close`,
    payload: { version: bug.version, category: 'duplicate', note: '重复 Bug', duplicateOfBugId: duplicateBug.id },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(closed.json().data.status, 'closed', closed.body)
  bug = closed.json().data

  const closeWithoutDuplicate = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${duplicateBug.id}/close`,
    payload: { version: duplicateBug.version, category: 'duplicate', note: '未指定原 Bug' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(closeWithoutDuplicate.json().code, 'VALIDATION_ERROR')

  const comments = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/comments`,
    payload: { bodyMarkdown: '补充证据' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(comments.json().success, true)
  const viewerComment = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/comments`,
    payload: { bodyMarkdown: '浏览者' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerComment.json().code, 'FORBIDDEN')

  const unlink = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bug.id}/requirements/${requirementId}/remove`,
    payload: { version: bug.version, reason: '关联错误' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(unlink.json().data.linkedRequirements.length, 0, unlink.body)

  const softDeleted = await app.inject({
    method: 'GET',
    url: `/api/v1/bugs/${bug.id}`,
    headers: { cookie: otherUser.cookie },
  })
  assert.equal(softDeleted.json().code, 'FORBIDDEN')

  // 待回归部分唯一索引兜底：同一 Bug 不能同时存在两条 pending 回归。
  await app.db.insert(bugRegressionTable).values({
    id: randomUUID(),
    team_id: teamId,
    bug_id: duplicateBug.id,
    attempt: 100,
    fix_summary: '直接插入 pending',
    fixer_user_id: devUser.userId,
    verifier_user_id: viewerUser.userId,
  })
  await assert.rejects(
    app.db.insert(bugRegressionTable).values({
      id: randomUUID(),
      team_id: teamId,
      bug_id: duplicateBug.id,
      attempt: 101,
      fix_summary: '重复 pending',
      fixer_user_id: devUser.userId,
      verifier_user_id: viewerUser.userId,
    }),
    (error: unknown) => {
      if (typeof error !== 'object' || error === null) return false
      const cause = 'cause' in error ? error.cause : error
      return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'
    },
  )
})
