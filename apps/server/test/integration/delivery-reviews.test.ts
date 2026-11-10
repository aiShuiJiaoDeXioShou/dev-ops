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

test('外部审核与发布结果：状态分离、历史不覆盖、未知处理与权限', { timeout: 90_000 }, async (t) => {
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
    payload: { name: '审核测试项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(projectResponse.json().success, true, projectResponse.body)
  const projectId = projectResponse.json().data.id as string
  const otherProjectResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '其他审核项目' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(otherProjectResponse.json().success, true, otherProjectResponse.body)
  const otherProjectId = otherProjectResponse.json().data.id as string
  const serviceId = randomUUID()
  const otherServiceId = randomUUID()
  await app.db.insert(projectService).values([
    {
      id: serviceId,
      team_id: teamId,
      project_id: projectId,
      name: '小程序',
      status: 'active',
      created_by_user_id: adminUser.userId,
    },
    {
      id: otherServiceId,
      team_id: teamId,
      project_id: otherProjectId,
      name: '其他小程序',
      status: 'active',
      created_by_user_id: adminUser.userId,
    },
  ])

  const reviewsUrl = `/api/v1/projects/${projectId}/reviews`
  const releasesUrl = `/api/v1/projects/${projectId}/releases`
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

  async function createReview(overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: reviewsUrl,
      payload: {
        targetType: 'mini_program',
        versionLabel: '1.0.0',
        reviewPlatform: 'wechat',
        submittedAt: minutesAgo(60),
        serviceId,
        note: '首次提审',
        evidenceUrl: 'https://evidence.example.test/review-1',
        ...overrides,
      },
      headers: { cookie: devUser.cookie },
    })
  }

  const created = await createReview()
  assert.equal(created.json().success, true, created.body)
  const reviewId = created.json().data.id as string
  assert.equal(created.json().data.reviewStatus, 'pending')
  assert.equal(created.json().data.version, 1)
  assert.equal(created.json().data.submittedBy, devUser.userId)

  const viewerList = await app.inject({
    method: 'GET',
    url: reviewsUrl,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerList.json().success, true, viewerList.body)
  assert.equal(viewerList.json().data.total, 1)
  const viewerDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/reviews/${reviewId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerDetail.json().data.id, reviewId)

  const viewerCreateResponse = await app.inject({
    method: 'POST',
    url: reviewsUrl,
    payload: {
      targetType: 'mobile_app',
      versionLabel: '2.0.0',
      reviewPlatform: 'app_store',
      submittedAt: minutesAgo(10),
    },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreateResponse.json().code, 'FORBIDDEN')

  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${reviewId}/update`,
    payload: {
      reviewStatus: 'approved',
      reviewedAt: minutesAgo(30),
      evidenceUrl: 'https://evidence.example.test/review-1-approved',
      version: 1,
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(approved.json().success, true, approved.body)
  assert.equal(approved.json().data.reviewStatus, 'approved')
  assert.equal(approved.json().data.version, 2)

  // 审核通过不等于已发布，发布记录必须单独记录。
  const releasesAfterApproval = await app.inject({
    method: 'GET',
    url: releasesUrl,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(releasesAfterApproval.json().data.total, 0)

  const notReleased = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: { reviewId, serviceId, versionLabel: '1.0.0', releaseStatus: 'not_released' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(notReleased.json().success, true, notReleased.body)
  assert.equal(notReleased.json().data.releaseStatus, 'not_released')
  assert.equal(notReleased.json().data.releasedAt, null)

  const released = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: {
      reviewId,
      serviceId,
      versionLabel: '1.0.0',
      releaseStatus: 'released',
      releasedAt: minutesAgo(20),
      scopeNote: '全量发布',
      evidenceUrl: 'https://evidence.example.test/release-1',
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(released.json().success, true, released.body)
  const releases = await app.inject({
    method: 'GET',
    url: releasesUrl,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(releases.json().data.total, 2)
  assert.equal(releases.json().data.items[0].releaseStatus, 'released')

  // 终态之间不允许静默覆盖；过期乐观锁返回冲突。
  const invalidTransition = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${reviewId}/update`,
    payload: { reviewStatus: 'rejected', reviewReason: '想改拒绝', version: 2 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(invalidTransition.json().code, 'INVALID_TRANSITION')
  const staleUpdate = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${reviewId}/update`,
    payload: { reviewStatus: 'unknown', version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(staleUpdate.json().code, 'VERSION_CONFLICT')

  // 拒绝必须填写原因，重新提审新增记录并保留历史。
  const rejectedCreate = await createReview({ versionLabel: '1.0.1' })
  assert.equal(rejectedCreate.json().success, true, rejectedCreate.body)
  const rejectedId = rejectedCreate.json().data.id as string
  const rejectedWithoutReason = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${rejectedId}/update`,
    payload: { reviewStatus: 'rejected', version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(rejectedWithoutReason.json().code, 'VALIDATION_ERROR')
  const rejected = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${rejectedId}/update`,
    payload: { reviewStatus: 'rejected', reviewReason: '资质信息缺失', reviewedAt: minutesAgo(15), version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(rejected.json().success, true, rejected.body)
  assert.equal(rejected.json().data.reviewStatus, 'rejected')
  assert.equal(rejected.json().data.reviewReason, '资质信息缺失')

  const resubmitted = await createReview({ versionLabel: '1.0.1', note: '补充资质后重新提审' })
  assert.equal(resubmitted.json().success, true, resubmitted.body)
  const resubmittedId = resubmitted.json().data.id as string
  const afterResubmit = await app.inject({
    method: 'GET',
    url: reviewsUrl,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(afterResubmit.json().data.total, 3)
  const oldRejected = afterResubmit.json().data.items.find((item: { id: string }) => item.id === rejectedId)
  assert.equal(oldRejected.reviewStatus, 'rejected')
  assert.equal(oldRejected.version, 2)

  // 未知可回传，也可在后续核对后进入终态。
  const unknownReview = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${resubmittedId}/update`,
    payload: { reviewStatus: 'unknown', version: 1 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(unknownReview.json().success, true, unknownReview.body)
  assert.equal(unknownReview.json().data.reviewStatus, 'unknown')
  const recovered = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${resubmittedId}/update`,
    payload: { reviewStatus: 'approved', reviewedAt: minutesAgo(5), version: 2 },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(recovered.json().success, true, recovered.body)
  assert.equal(recovered.json().data.reviewStatus, 'approved')

  const partialRelease = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: {
      serviceId,
      versionLabel: '1.0.1',
      releaseStatus: 'partially_released',
      releasedAt: minutesAgo(3),
      scopeNote: '仅灰度 10%',
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(partialRelease.json().success, true, partialRelease.body)
  const partialFilter = await app.inject({
    method: 'GET',
    url: `${releasesUrl}?releaseStatus=partially_released`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(partialFilter.json().data.total, 1)
  const byReview = await app.inject({
    method: 'GET',
    url: `${releasesUrl}?reviewId=${reviewId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(byReview.json().data.total, 2)

  const reviewFilter = await app.inject({
    method: 'GET',
    url: `${reviewsUrl}?reviewStatus=rejected`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(reviewFilter.json().data.total, 1)
  const targetFilter = await app.inject({
    method: 'GET',
    url: `${reviewsUrl}?targetType=mobile_app`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(targetFilter.json().data.total, 0)

  // 跨项目关联、非法服务、未来时间与权限校验。
  const foreignReviewResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${otherProjectId}/reviews`,
    payload: {
      targetType: 'mobile_app',
      versionLabel: '9.0.0',
      reviewPlatform: 'app_store',
      submittedAt: minutesAgo(60),
      serviceId: otherServiceId,
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(foreignReviewResponse.json().success, true, foreignReviewResponse.body)
  const foreignReviewId = foreignReviewResponse.json().data.id as string
  const crossProjectRelease = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: { reviewId: foreignReviewId, versionLabel: '9.0.0', releaseStatus: 'released' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(crossProjectRelease.json().code, 'VALIDATION_ERROR')

  const foreignServiceReview = await createReview({ serviceId: otherServiceId, versionLabel: '9.0.1' })
  assert.equal(foreignServiceReview.json().code, 'NOT_FOUND')
  const missingReviewRelease = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: { reviewId: randomUUID(), versionLabel: '9.0.2', releaseStatus: 'unknown' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(missingReviewRelease.json().code, 'VALIDATION_ERROR')
  const futureReview = await createReview({ submittedAt: new Date(Date.now() + 60 * 60_000).toISOString() })
  assert.equal(futureReview.json().code, 'VALIDATION_ERROR')

  const viewerUpdate = await app.inject({
    method: 'POST',
    url: `/api/v1/reviews/${reviewId}/update`,
    payload: { reviewStatus: 'unknown', version: 2 },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerUpdate.json().code, 'FORBIDDEN')
  const viewerRelease = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: { versionLabel: '1.0.0', releaseStatus: 'unknown' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerRelease.json().code, 'FORBIDDEN')
  const outsiderList = await app.inject({
    method: 'GET',
    url: reviewsUrl,
    headers: { cookie: outsiderUser.cookie },
  })
  assert.equal(outsiderList.json().code, 'FORBIDDEN')
  const missingReview = await app.inject({
    method: 'GET',
    url: `/api/v1/reviews/${randomUUID()}`,
    headers: { cookie: devUser.cookie },
  })
  assert.equal(missingReview.json().code, 'NOT_FOUND')

  // 停用服务不允许新的提审与发布记录。
  await app.db
    .update(projectService)
    .set({ status: 'disabled', updated_at: new Date() })
    .where(eq(projectService.id, serviceId))
  const disabledReview = await createReview({ versionLabel: '3.0.0' })
  assert.equal(disabledReview.json().code, 'PRECONDITION_FAILED')
  const disabledRelease = await app.inject({
    method: 'POST',
    url: releasesUrl,
    payload: { serviceId, versionLabel: '3.0.0', releaseStatus: 'unknown' },
    headers: { cookie: devUser.userId ? devUser.cookie : devUser.cookie },
  })
  assert.equal(disabledRelease.json().code, 'PRECONDITION_FAILED')
})
