import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { requirement } from '../../src/modules/requirements/requirements.tables.ts'
import { bug } from '../../src/modules/bugs/bugs.tables.ts'
import { attachment } from '../../src/modules/attachments/attachments.tables.ts'
import { createAttachmentStorageFixture } from '../support/attachment-storage.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('需求与缺陷的附件绑定、最终集合更新、不可编辑与权限校验', { timeout: 120_000 }, async (t) => {
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

  const storageFixture = await createAttachmentStorageFixture()
  cleanup.push(() => storageFixture.cleanup())

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '5000',
    DB_LOCK_TIMEOUT_MS: '1000',
    ATTACHMENT_STORAGE_DIR: storageFixture.rootDir,
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })

  const adminUser = await createAuthenticatedUser(app, { name: '团队管理员' })
  const devUser = await createAuthenticatedUser(app, { name: '开发者' })
  const teamId = randomUUID()
  await app.db.insert(team).values({
    id: teamId,
    name: `team-${randomBytes(3).toString('hex')}`,
    created_by_user_id: adminUser.userId,
  })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
  ])
  const projectId = randomUUID()
  const otherProjectId = randomUUID()
  await app.db.insert(project).values([
    {
      id: projectId,
      team_id: teamId,
      name: '附件绑定项目',
      owner_user_id: adminUser.userId,
      created_by_user_id: adminUser.userId,
    },
    {
      id: otherProjectId,
      team_id: teamId,
      name: '同团队其他项目',
      owner_user_id: adminUser.userId,
      created_by_user_id: adminUser.userId,
    },
  ])

  async function upload(cookie: string, projectIdValue = projectId, fileName = '证据.txt') {
    const bytes = Buffer.from(`附件内容-${randomUUID()}`)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectIdValue}/attachments`,
      payload: bytes,
      headers: {
        cookie,
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(fileName),
        'x-file-type': 'text/plain',
        'content-length': String(bytes.length),
      },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.success, true, response.body)
    return body.data.attachment as { id: string; fileName: string; sizeBytes: number; sha256: string }
  }

  async function attachmentStatus(attachmentId: string) {
    const [row] = await app.db
      .select({ status: attachment.status })
      .from(attachment)
      .where(eq(attachment.id, attachmentId))
    return row?.status
  }

  const attachmentA = await upload(devUser.cookie, projectId, '需求证据A.txt')
  const attachmentB = await upload(devUser.cookie, projectId, '需求证据B.txt')

  const createdRequirement = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '带附件的需求',
      contentMode: 'markdown',
      contentMarkdown: '正文',
      attachmentIds: [attachmentA.id, attachmentB.id],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(createdRequirement.statusCode, 200, createdRequirement.body)
  const createdRequirementBody = createdRequirement.json()
  assert.equal(createdRequirementBody.success, true)
  assert.deepEqual(
    createdRequirementBody.data.attachments.map((item: { id: string }) => item.id).sort(),
    [attachmentA.id, attachmentB.id].sort(),
  )
  const firstAttachment = createdRequirementBody.data.attachments.find(
    (item: { id: string }) => item.id === attachmentA.id,
  )
  assert.equal(firstAttachment.fileName, '需求证据A.txt')
  assert.equal(firstAttachment.sizeBytes, attachmentA.sizeBytes)
  assert.equal(firstAttachment.sha256, attachmentA.sha256)
  assert.equal(firstAttachment.uploadedBy.userId, devUser.userId)
  assert.equal(firstAttachment.downloadUrl, `/api/v1/attachments/${attachmentA.id}/download`)
  assert.equal(await attachmentStatus(attachmentA.id), 'bound')
  const requirementId = createdRequirementBody.data.id as string

  const attachmentC = await upload(devUser.cookie)
  const updatedRequirement = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: { version: 1, attachmentIds: [attachmentA.id, attachmentC.id] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updatedRequirement.statusCode, 200, updatedRequirement.body)
  assert.equal(updatedRequirement.json().data.version, 2)
  assert.deepEqual(
    updatedRequirement
      .json()
      .data.attachments.map((item: { id: string }) => item.id)
      .sort(),
    [attachmentA.id, attachmentC.id].sort(),
  )
  assert.equal(await attachmentStatus(attachmentB.id), 'removed', '最终集合中缺失的附件应被移除')
  assert.equal(await attachmentStatus(attachmentA.id), 'bound')
  assert.equal(await attachmentStatus(attachmentC.id), 'bound')

  const crossProjectAttachment = await upload(devUser.cookie, otherProjectId, '跨项目.txt')
  const crossProject = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '跨项目附件',
      contentMode: 'markdown',
      contentMarkdown: '正文',
      attachmentIds: [crossProjectAttachment.id],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(crossProject.json().success, false)
  assert.equal(crossProject.json().code, 'ATTACHMENT_INVALID')
  assert.equal(await attachmentStatus(crossProjectAttachment.id), 'temp', '跨项目绑定失败不得留下部分结果')

  // 需求进入不可编辑状态后，即使只改附件也拒绝。
  await app.db.update(requirement).set({ status: 'submitted' }).where(eq(requirement.id, requirementId))
  const frozenRequirement = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${requirementId}/update`,
    payload: { version: 2, attachmentIds: [attachmentA.id] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(frozenRequirement.json().success, false)
  assert.equal(frozenRequirement.json().code, 'INVALID_TRANSITION')
  assert.equal(await attachmentStatus(attachmentC.id), 'bound', '不可编辑状态失败不得移除附件')

  // 开发者不能通过"最终集合"删除他人上传的附件，整次更新回滚。
  const adminAttachment = await upload(adminUser.cookie, projectId, '管理员上传.txt')
  const adminRequirement = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: {
      title: '管理员的需求',
      contentMode: 'markdown',
      contentMarkdown: '正文',
      attachmentIds: [adminAttachment.id],
    },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(adminRequirement.statusCode, 200, adminRequirement.body)
  const adminRequirementId = adminRequirement.json().data.id as string
  const forbiddenRemove = await app.inject({
    method: 'POST',
    url: `/api/v1/requirements/${adminRequirementId}/update`,
    payload: { version: 1, attachmentIds: [] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(forbiddenRemove.json().success, false)
  assert.equal(forbiddenRemove.json().code, 'FORBIDDEN')
  assert.equal(await attachmentStatus(adminAttachment.id), 'bound', '越权移除应整体回滚')

  // 缺陷侧复用同一绑定能力。
  const bugAttachmentA = await upload(devUser.cookie)
  const bugAttachmentB = await upload(devUser.cookie)
  const createdBug = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: {
      title: '带附件的缺陷',
      phenomenon: '现象',
      expectedBehavior: '预期',
      reproductionUnknown: true,
      attachmentIds: [bugAttachmentA.id, bugAttachmentB.id],
    },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(createdBug.statusCode, 200, createdBug.body)
  assert.equal(createdBug.json().data.attachments.length, 2)
  const bugId = createdBug.json().data.id as string

  const updatedBug = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugId}/update`,
    payload: { version: 1, attachmentIds: [bugAttachmentB.id] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updatedBug.statusCode, 200, updatedBug.body)
  assert.deepEqual(
    updatedBug.json().data.attachments.map((item: { id: string }) => item.id),
    [bugAttachmentB.id],
  )
  assert.equal(await attachmentStatus(bugAttachmentA.id), 'removed')

  await app.db.update(bug).set({ status: 'closed' }).where(eq(bug.id, bugId))
  const frozenBug = await app.inject({
    method: 'POST',
    url: `/api/v1/bugs/${bugId}/update`,
    payload: { version: 2, attachmentIds: [] },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(frozenBug.json().success, false)
  assert.equal(frozenBug.json().code, 'INVALID_TRANSITION')
  assert.equal(await attachmentStatus(bugAttachmentB.id), 'bound')
})
