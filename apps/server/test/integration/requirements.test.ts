import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import sharp from 'sharp'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { requirement } from '../../src/modules/requirements/requirements.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('需求创建、内容校验、筛选、版本、评论、活动、项目计数与跨团队权限', { timeout: 90_000 }, async (t) => {
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
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '需求测试项目',
    owner_user_id: adminUser.userId,
    created_by_user_id: adminUser.userId,
  })

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '登录能力',
      contentMode: 'markdown',
      contentMarkdown: '# 正文\n\n说明',
      acceptanceCriteria: '可登录',
      devOwnerUserId: devUser.userId,
      testOwnerUserId: viewerUser.userId,
      collaboratorUserIds: [viewerUser.userId, viewerUser.userId],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(created.statusCode, 200, created.body)
  const requirementBody = created.json()
  assert.equal(requirementBody.success, true)
  assert.equal(requirementBody.data.number, 1)
  assert.equal(requirementBody.data.devOwner.userId, devUser.userId)
  assert.equal(requirementBody.data.testOwner.name, '浏览者')
  assert.equal(requirementBody.data.collaborators.length, 1)
  assert.equal(requirementBody.data.collaborators[0].userId, viewerUser.userId)
  assert.equal(requirementBody.data.latestTestSubmission, null)
  const requirementId = requirementBody.data.id as string

  const second = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '退出能力',
      contentMode: 'external_link',
      externalUrl: 'https://example.com/spec',
      externalSummary: '摘要',
    },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(second.json().data.number, 2)

  const invalidMarkdown = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: { title: '空正文', contentMode: 'markdown', contentMarkdown: '' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(invalidMarkdown.json().code, 'VALIDATION_ERROR')

  const invalidUrl = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: { title: '坏链接', contentMode: 'external_link', externalUrl: 'javascript:alert(1)' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(invalidUrl.json().code, 'VALIDATION_ERROR')

  const viewerCreate = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: { title: '浏览者', contentMode: 'markdown', contentMarkdown: 'x' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/requirements?status=pending&ownerId=${devUser.userId}&search=登录`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(list.json().success, true)
  assert.equal(list.json().data.total, 1)
  assert.equal(list.json().data.items[0].number, 1)

  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(detail.json().data.contentMarkdown, '# 正文\n\n说明')
  assert.deepEqual(detail.json().data.linkedBugs, [])

  const updated = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: { version: 1, title: '登录能力 v2', devOwnerUserId: adminUser.userId },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal(updated.json().data.version, 2)
  assert.equal(updated.json().data.title, '登录能力 v2')
  assert.equal(updated.json().data.devOwner.userId, adminUser.userId)

  const conflict = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: { version: 1, title: '旧版本' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(conflict.json().code, 'VERSION_CONFLICT')

  // 进入已提交状态后不允许修改范围字段。
  await app.db.update(requirement).set({ status: 'submitted', version: 3 }).where(eq(requirement.id, requirementId))
  const frozen = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: { version: 3, contentMode: 'markdown', contentMarkdown: '未重新交接的范围' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(frozen.json().code, 'INVALID_TRANSITION')

  const plan = [
    {
      id: 'in_testing',
      title: '验收',
      startsOn: null,
      endsOn: null,
      tasks: [{ id: 'check-login', title: '检查登录', startsOn: '2026-11-18', endsOn: '2026-11-19', done: false }],
    },
  ]
  const edit = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: { version: 3, title: '登录能力 v3', testOwnerUserId: devUser.userId, plan },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(edit.json().success, true, edit.body)
  assert.equal(edit.json().data.status, 'submitted')
  assert.equal(edit.json().data.testOwner.userId, devUser.userId)
  assert.deepEqual(edit.json().data.plan, plan)

  const invalidPlan = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: {
      version: 4,
      plan: [{ id: 'extra', title: '错误日期', startsOn: '2026-02-30', endsOn: null, tasks: [] }],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(invalidPlan.json().code, 'VALIDATION_ERROR')
  const planned = await app.inject({
    url: `/api/v1/requirements/${requirementId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.deepEqual(planned.json().data.plan, plan)
  assert.equal(planned.json().data.version, 4)

  const viewerComment = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/comments`,
    payload: { bodyMarkdown: '浏览者不能评论' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerComment.json().code, 'FORBIDDEN')

  const comment = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/comments`,
    payload: { bodyMarkdown: '请补充异常路径' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(comment.statusCode, 200, comment.body)
  assert.equal(comment.json().data.bodyMarkdown, '请补充异常路径')
  const comments = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}/comments`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(comments.json().data.total, 1)
  assert.equal(comments.json().data.items[0].authorUserId, devUser.userId)
  assert.equal(comments.json().data.items[0].authorName, comment.json().data.authorName)
  assert.equal(comments.json().data.items[0].authorName, '开发者')

  await t.test('历史评论与成员资料读取当前头像，跨团队仍拒绝访问', async () => {
    assert.equal(comments.json().data.items[0].authorImage, undefined)
    const jpeg = await sharp({ create: { width: 160, height: 160, channels: 3, background: 'blue' } })
      .jpeg()
      .toBuffer()
    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/update-user',
      headers: { cookie: devUser.cookie, origin: config.APP_ORIGIN },
      payload: { image: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
    })
    assert.equal(change.statusCode, 200, change.body)
    const session = await app.inject({ url: '/api/v1/auth/get-session', headers: { cookie: devUser.cookie } })
    const savedImage: unknown = session.json().user.image
    assert.equal(typeof savedImage, 'string')

    const commentsUrl = `/api/v1/requirements/${requirementId}/comments`
    const reloaded = await app.inject({ url: commentsUrl, headers: { cookie: viewerUser.cookie } })
    assert.equal(reloaded.json().data.items[0].authorImage, savedImage)
    const ownerUpdate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/update-user',
      headers: { cookie: adminUser.cookie, origin: config.APP_ORIGIN },
      payload: { image: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
    })
    assert.equal(ownerUpdate.statusCode, 200, ownerUpdate.body)
    const detail = await app.inject({
      url: `/api/v1/requirements/${requirementId}`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(detail.json().data.devOwner.userId, adminUser.userId)
    assert.equal(detail.json().data.devOwner.image, savedImage)

    const projects = await app.inject({
      url: `/api/v1/teams/${teamId}/projects`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(projects.json().data.items[0].owner.image, savedImage)

    const members = await app.inject({
      url: `/api/v1/teams/${teamId}/members`,
      headers: { cookie: viewerUser.cookie },
    })
    const listedMembers: { userId: string; image?: string }[] = members.json().data
    assert.equal(listedMembers.find(({ userId }) => userId === devUser.userId)?.image, savedImage)
    assert.equal(listedMembers.find(({ userId }) => userId === viewerUser.userId)?.image, undefined)

    const other = await app.inject({ url: commentsUrl, headers: { cookie: otherUser.cookie } })
    assert.equal(other.json().code, 'FORBIDDEN')
  })

  const activities = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}/activities`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.ok(activities.json().data.total >= 2)
  assert.equal(activities.json().data.items[0].action, 'requirement_updated')

  const stats = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/stats`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(stats.json().data.openRequirements, 2)

  const [concurrentA, concurrentB] = await Promise.all([
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/requirements`,
      payload: { title: '并发 A', contentMode: 'markdown', contentMarkdown: 'A' },
      headers: { cookie: adminUser.cookie },
    }),
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/requirements`,
      payload: { title: '并发 B', contentMode: 'markdown', contentMarkdown: 'B' },
      headers: { cookie: adminUser.cookie },
    }),
  ])
  assert.equal(concurrentA.json().success, true, concurrentA.body)
  assert.equal(concurrentB.json().success, true, concurrentB.body)
  const concurrentNumbers = [concurrentA.json().data.number, concurrentB.json().data.number].sort(
    (a: number, b: number) => a - b,
  )
  assert.deepEqual(concurrentNumbers, [3, 4])

  const crossTeam = await app.inject({
    method: 'GET',
    url: `/api/v1/requirements/${requirementId}`,
    headers: { cookie: otherUser.cookie },
  })
  assert.equal(crossTeam.json().code, 'FORBIDDEN')

  await t.test('流程模板分类型保存，新建事项继承节点，旧事项保留规划', async () => {
    const projectPath = '/api/v1/projects/' + projectId
    const headers = { cookie: adminUser.cookie }
    const projectDetail = await app.inject({ url: projectPath, headers })
    const version: number = projectDetail.json().data.version
    const oldItem = await app.inject({ url: '/api/v1/requirements/' + requirementId, headers })
    const oldPlan: unknown = oldItem.json().data.plan
    const requirementNodes = [
      { id: 'pending', title: '待处理' },
      { id: 'in_development', title: '研发执行' },
      { id: 'review', title: '上线前审查' },
      { id: 'submitted', title: '待测试' },
      { id: 'in_testing', title: '测试' },
      { id: 'passed', title: '已通过' },
    ]
    const bugNodes = [
      { id: 'pending', title: '故障确认' },
      { id: 'in_fix', title: '定位与修复' },
      { id: 'in_regression', title: '回归' },
      { id: 'resolved', title: '已解决' },
    ]
    const update = (
      kind: 'requirement' | 'bug',
      nodes: typeof requirementNodes,
      expectedVersion: number,
      cookie = adminUser.cookie,
    ) =>
      app.inject({
        method: 'POST',
        url: projectPath + '/update',
        headers: { cookie },
        payload: { version: expectedVersion, workItemTemplate: { kind, nodes } },
      })
    const noStages = await update('requirement', [{ id: 'review', title: '评审' }], version)
    assert.equal(noStages.json().code, 'VALIDATION_ERROR')
    const forbidden = await update('requirement', requirementNodes, version, viewerUser.cookie)
    assert.equal(forbidden.json().code, 'FORBIDDEN')
    const saved = await update('requirement', requirementNodes, version)
    assert.equal(saved.json().success, true, saved.body)
    assert.deepEqual(saved.json().data.workItemTemplates, { requirement: requirementNodes })
    const conflict = await update('bug', bugNodes, version)
    assert.equal(conflict.json().code, 'VERSION_CONFLICT')
    const savedBug = await update('bug', bugNodes, version + 1)
    assert.equal(savedBug.json().success, true, savedBug.body)
    assert.deepEqual(savedBug.json().data.workItemTemplates, { requirement: requirementNodes, bug: bugNodes })

    const inheritedRequirement = await app.inject({
      method: 'POST',
      url: projectPath + '/requirements',
      headers,
      payload: { title: '带模板的需求', contentMode: 'markdown', contentMarkdown: '验证模板快照' },
    })
    assert.equal(inheritedRequirement.json().success, true, inheritedRequirement.body)
    assert.deepEqual(
      inheritedRequirement.json().data.plan,
      requirementNodes.map((node) => ({ ...node, startsOn: null, endsOn: null, tasks: [] })),
    )
    const inheritedBug = await app.inject({
      method: 'POST',
      url: projectPath + '/bugs',
      headers,
      payload: {
        title: '带模板的 Bug',
        phenomenon: '未显示内容',
        expectedBehavior: '显示内容',
        reproductionUnknown: true,
      },
    })
    assert.equal(inheritedBug.json().success, true, inheritedBug.body)
    assert.deepEqual(
      inheritedBug.json().data.plan,
      bugNodes.map((node) => ({ ...node, startsOn: null, endsOn: null, tasks: [] })),
    )

    const oldItemAfterSave = await app.inject({ url: '/api/v1/requirements/' + requirementId, headers })
    assert.deepEqual(oldItemAfterSave.json().data.plan, oldPlan)
    const templateChangedAgain = await update(
      'requirement',
      requirementNodes.map((node) => (node.id === 'review' ? { ...node, title: '回看记录' } : node)),
      version + 2,
    )
    assert.equal(templateChangedAgain.json().success, true, templateChangedAgain.body)
    const createdBeforeTemplateEdit = await app.inject({
      url: '/api/v1/requirements/' + inheritedRequirement.json().data.id,
      headers,
    })
    assert.deepEqual(createdBeforeTemplateEdit.json().data.plan, inheritedRequirement.json().data.plan)
  })
})
