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

test('流水线运行记录：幂等上报、状态历史、乱序不覆盖、筛选与权限', { timeout: 90_000 }, async (t) => {
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
    payload: { name: '流水线测试项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(projectResponse.json().success, true, projectResponse.body)
  const projectId = projectResponse.json().data.id as string
  const serviceId = randomUUID()
  await app.db.insert(projectService).values({
    id: serviceId,
    team_id: teamId,
    project_id: projectId,
    name: '后端接口',
    status: 'active',
    created_by_user_id: adminUser.userId,
  })

  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  const startedAt = minutesAgo(30)
  const finishedAt = minutesAgo(10)
  const firstReportedAt = minutesAgo(20)
  const secondReportedAt = minutesAgo(10)

  const pipelineUrl = `/api/v1/projects/${projectId}/pipeline-runs`
  const reportRun = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: pipelineUrl,
      payload: {
        pipelineName: '主流水线',
        pipelineKey: 'main-ci',
        serviceId,
        commitRef: 'abc1234',
        triggerSource: 'push',
        startedAt,
        source: 'github_actions',
        sourceRunId: 'run-1',
        ...payload,
      },
      headers: { cookie: devUser.cookie },
    })

  const running = await reportRun({ status: 'running', reportedAt: firstReportedAt })
  assert.equal(running.json().success, true, running.body)
  const runId = running.json().data.id as string
  assert.equal(running.json().data.status, 'running')
  assert.equal(running.json().data.serviceId, serviceId)
  assert.equal(running.json().data.statusHistory.length, 1)

  const succeeded = await reportRun({ status: 'succeeded', finishedAt, reportedAt: secondReportedAt })
  assert.equal(succeeded.json().data.id, runId)
  assert.equal(succeeded.json().data.status, 'succeeded')
  assert.equal(succeeded.json().data.statusHistory.length, 2)
  assert.deepEqual(
    succeeded
      .json()
      .data.statusHistory.map((item: { status: string }) => item.status)
      .sort(),
    ['running', 'succeeded'],
  )

  // 相同上报时间重复提交按幂等处理，不重复写状态历史。
  const duplicate = await reportRun({ status: 'succeeded', finishedAt, reportedAt: secondReportedAt })
  assert.equal(duplicate.json().data.id, runId)
  assert.equal(duplicate.json().data.statusHistory.length, 2)

  // 较旧上报不得覆盖较新状态。
  const stale = await reportRun({ status: 'failed', reportedAt: firstReportedAt })
  assert.equal(stale.json().data.id, runId)
  assert.equal(stale.json().data.status, 'succeeded')
  assert.equal(stale.json().data.statusHistory.length, 2)
  assert.equal(stale.json().data.lastReportedAt, new Date(secondReportedAt).toISOString())

  // 更新的未知状态按来源失联记录，不伪造成功。
  const unknown = await reportRun({ status: 'unknown', reportedAt: minutesAgo(5) })
  assert.equal(unknown.json().data.status, 'unknown')
  assert.equal(unknown.json().data.statusHistory.length, 3)

  const secondRun = await reportRun({
    pipelineName: '主流水线',
    pipelineKey: 'main-ci',
    serviceId,
    status: 'failed',
    sourceRunId: 'run-2',
    reportedAt: secondReportedAt,
    finishedAt,
  })
  assert.equal(secondRun.json().success, true, secondRun.body)
  assert.notEqual(secondRun.json().data.id, runId)

  const list = await app.inject({
    method: 'GET',
    url: pipelineUrl,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(list.json().success, true, list.body)
  assert.equal(list.json().data.total, 2)
  assert.deepEqual(
    list
      .json()
      .data.items.map((item: { sourceRunId: string }) => item.sourceRunId)
      .sort(),
    ['run-1', 'run-2'],
  )

  const byStatus = await app.inject({
    method: 'GET',
    url: `${pipelineUrl}?status=unknown`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(byStatus.json().data.total, 1)
  const byService = await app.inject({
    method: 'GET',
    url: `${pipelineUrl}?serviceId=${serviceId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(byService.json().data.total, 2)
  const utcDay = new Date(startedAt).toISOString().slice(0, 10)
  const byDay = await app.inject({
    method: 'GET',
    url: `${pipelineUrl}?from=${utcDay}&to=${utcDay}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(byDay.json().data.total, 2)
  const emptyDay = await app.inject({
    method: 'GET',
    url: `${pipelineUrl}?from=2001-01-01&to=2001-01-02`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(emptyDay.json().data.total, 0)
  const invalidDay = await app.inject({
    method: 'GET',
    url: `${pipelineUrl}?from=2026/01/01`,
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(invalidDay.json().code, 'VALIDATION_ERROR')

  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/pipeline-runs/${runId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(detail.json().success, true, detail.body)
  assert.equal(detail.json().data.statusHistory.length, 3)

  // 运行详情按来源运行标识展示可追溯的构建记录。
  const build = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/builds`,
    payload: {
      serviceId,
      environment: 'test',
      buildKey: 'ci-related-build',
      versionLabel: '1.0.0',
      source: 'pipeline',
      sourceRunId: 'run-1',
      collectedAt: minutesAgo(8),
      resultStatus: 'succeeded',
      note: '关联构建',
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(build.json().success, true, build.body)
  const detailWithBuild = await app.inject({
    method: 'GET',
    url: `/api/v1/pipeline-runs/${runId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(detailWithBuild.json().data.relatedBuilds.length, 1)
  assert.equal(detailWithBuild.json().data.relatedBuilds[0].id, build.json().data.id)

  // 流水线结果不改变运行版本。
  const runVersions = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/services/${serviceId}/run-versions`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.ok(
    runVersions.json().data.items.every((item: { versionLabel: string | null }) => item.versionLabel === null),
    '流水线上报不得自动写入运行版本',
  )

  const invalidStatus = await reportRun({ status: 'done', reportedAt: minutesAgo(1), sourceRunId: 'run-3' })
  assert.equal(invalidStatus.json().code, 'VALIDATION_ERROR')
  const invalidRange = await reportRun({
    status: 'running',
    reportedAt: minutesAgo(1),
    sourceRunId: 'run-4',
    startedAt: finishedAt,
    finishedAt: startedAt,
  })
  assert.equal(invalidRange.json().code, 'VALIDATION_ERROR')

  const viewerReport = await app.inject({
    method: 'POST',
    url: pipelineUrl,
    payload: {
      pipelineName: '主流水线',
      pipelineKey: 'main-ci',
      triggerSource: 'push',
      status: 'running',
      source: 'github_actions',
      sourceRunId: 'run-viewer',
      reportedAt: minutesAgo(1),
    },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerReport.json().code, 'FORBIDDEN')

  const outsiderList = await app.inject({
    method: 'GET',
    url: pipelineUrl,
    headers: { cookie: outsiderUser.cookie },
  })
  assert.equal(outsiderList.json().code, 'FORBIDDEN')
  const outsiderDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/pipeline-runs/${runId}`,
    headers: { cookie: outsiderUser.cookie },
  })
  assert.equal(outsiderDetail.json().code, 'FORBIDDEN')
  const missingDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/pipeline-runs/${randomUUID()}`,
    headers: { cookie: devUser.cookie },
  })
  assert.equal(missingDetail.json().code, 'NOT_FOUND')

  // 停用服务不允许新的流水线上报。
  await app.db
    .update(projectService)
    .set({ status: 'disabled', updated_at: new Date() })
    .where(eq(projectService.id, serviceId))
  const disabledReport = await reportRun({ status: 'running', reportedAt: minutesAgo(1), sourceRunId: 'run-5' })
  assert.equal(disabledReport.json().code, 'PRECONDITION_FAILED')
})
