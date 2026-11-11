import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { Client } from 'pg'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { idempotencyRecord } from '../../src/platform/database/idempotency.tables.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { requirement } from '../../src/modules/requirements/requirements.tables.ts'
import { attachment } from '../../src/modules/attachments/attachments.tables.ts'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import {
  bindAttachments,
  listAttachmentsForTarget,
  unbindAttachments,
} from '../../src/modules/attachments/attachments.binding.ts'
import { createAttachmentCleanup } from '../../src/modules/attachments/attachments.cleanup.ts'
import { createStorageService } from '../../src/modules/storage/storage.service.ts'
import { createAttachmentStorageFixture } from '../support/attachment-storage.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

const MAX_FILE_BYTES = 1_048_576
const TEMP_TTL_HOURS = 24

test('附件上传、绑定、下载、删除、清理与权限矩阵', { timeout: 120_000 }, async (t) => {
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
    ATTACHMENT_MAX_BYTES: String(MAX_FILE_BYTES),
    ATTACHMENT_TEMP_TTL_HOURS: String(TEMP_TTL_HOURS),
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })

  const teamAdmin = await createAuthenticatedUser(app, { name: '团队管理员' })
  const developer = await createAuthenticatedUser(app, { name: '开发者' })
  const otherDeveloper = await createAuthenticatedUser(app, { name: '其他开发者' })
  const projectOwner = await createAuthenticatedUser(app, { name: '项目负责人' })
  const viewer = await createAuthenticatedUser(app, { name: '浏览者' })
  const outsider = await createAuthenticatedUser(app, { name: '其他团队成员' })

  const teamId = randomUUID()
  const otherTeamId = randomUUID()
  await app.db.insert(team).values([
    { id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: teamAdmin.userId },
    { id: otherTeamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: outsider.userId },
  ])
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: teamAdmin.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: developer.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: otherDeveloper.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: projectOwner.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewer.userId, role: 'viewer', status: 'active' },
    { id: randomUUID(), team_id: otherTeamId, user_id: outsider.userId, role: 'admin', status: 'active' },
  ])

  const projectId = randomUUID()
  const otherProjectId = randomUUID()
  await app.db.insert(project).values([
    {
      id: projectId,
      team_id: teamId,
      name: '附件项目',
      owner_user_id: projectOwner.userId,
      created_by_user_id: teamAdmin.userId,
    },
    {
      id: otherProjectId,
      team_id: otherTeamId,
      name: '其他团队项目',
      owner_user_id: outsider.userId,
      created_by_user_id: outsider.userId,
    },
  ])

  async function createRequirementRow(targetProjectId: string, ownerUserId: string): Promise<string> {
    const requirementId = randomUUID()
    await app.db.insert(requirement).values({
      id: requirementId,
      team_id: teamId,
      project_id: targetProjectId,
      number: 1,
      title: '附件需求',
      content_mode: 'markdown',
      content_markdown: '正文',
      created_by_user_id: ownerUserId,
    })
    return requirementId
  }
  const requirementId = await createRequirementRow(projectId, teamAdmin.userId)

  const bindingPolicy = {
    maxFilesPerSubmit: config.ATTACHMENT_MAX_PER_SUBMIT,
    maxFilesPerRecord: config.ATTACHMENT_MAX_PER_RECORD,
    tempRetentionHours: config.ATTACHMENT_TEMP_TTL_HOURS,
  }

  async function uploadAttachment(input: {
    cookie: string
    projectId?: string
    fileName?: string
    contentType?: string
    bytes?: Buffer
    headers?: Record<string, string>
  }) {
    const bytes = input.bytes ?? Buffer.from(`附件内容-${randomUUID()}`)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${input.projectId ?? projectId}/attachments`,
      payload: bytes,
      headers: {
        cookie: input.cookie,
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(input.fileName ?? '复现截图.png'),
        'x-file-type': input.contentType ?? 'image/png',
        'content-length': String(bytes.length),
        ...input.headers,
      },
    })
    return { response, bytes }
  }

  async function uploadSucceeded(cookie: string, fileName = '复现截图.png') {
    const { response, bytes } = await uploadAttachment({ cookie, fileName })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.success, true, response.body)
    return { attachment: body.data.attachment, bytes }
  }

  // 主链路：上传返回临时附件摘要，包含服务端计算的 SHA-256。
  const uploaded = await uploadSucceeded(developer.cookie)
  assert.equal(uploaded.attachment.status, 'temp')
  assert.equal(uploaded.attachment.fileName, '复现截图.png')
  assert.equal(uploaded.attachment.contentType, 'image/png')
  assert.equal(uploaded.attachment.sizeBytes, uploaded.bytes.length)
  assert.equal(uploaded.attachment.sha256, createHash('sha256').update(uploaded.bytes).digest('hex'))
  assert.equal('storageKey' in uploaded.attachment, false)

  const policyResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/attachments/policy',
    headers: { cookie: developer.cookie },
  })
  assert.equal(policyResponse.statusCode, 200)
  assert.deepEqual(policyResponse.json().data, {
    maxFileBytes: MAX_FILE_BYTES,
    maxFilesPerSubmit: config.ATTACHMENT_MAX_PER_SUBMIT,
    maxFilesPerRecord: config.ATTACHMENT_MAX_PER_RECORD,
    tempRetentionHours: TEMP_TTL_HOURS,
  })

  // 未绑定临时附件仅上传者本人可见可删；其他成员即使知道附件 ID 也按不存在处理。
  const restrictedTemp = await uploadSucceeded(developer.cookie, '临时限制.txt')
  for (const cookie of [otherDeveloper.cookie, viewer.cookie, teamAdmin.cookie]) {
    const tempDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${restrictedTemp.attachment.id}/download`,
      headers: { cookie },
    })
    assert.equal(tempDownload.statusCode, 200)
    assert.equal(tempDownload.json().code, 'ATTACHMENT_NOT_FOUND')
    const tempRemove = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${restrictedTemp.attachment.id}/remove`,
      headers: { cookie },
    })
    assert.equal(tempRemove.statusCode, 200)
    assert.equal(tempRemove.json().code, 'ATTACHMENT_NOT_FOUND')
  }
  const uploaderTempDownload = await app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${restrictedTemp.attachment.id}/download`,
    headers: { cookie: developer.cookie },
  })
  assert.equal(uploaderTempDownload.statusCode, 200)
  assert.equal(uploaderTempDownload.headers['content-type'], 'application/octet-stream')
  assert.deepEqual(uploaderTempDownload.rawPayload, restrictedTemp.bytes)
  const uploaderTempRemove = await app.inject({
    method: 'POST',
    url: `/api/v1/attachments/${restrictedTemp.attachment.id}/remove`,
    headers: { cookie: developer.cookie },
  })
  assert.equal(uploaderTempRemove.json().success, true)
  const afterTempRemove = await app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${restrictedTemp.attachment.id}/download`,
    headers: { cookie: developer.cookie },
  })
  assert.equal(afterTempRemove.json().code, 'ATTACHMENT_NOT_FOUND')

  // 绑定必须是上传者本人；绑定后在详情列表可见。
  await assert.rejects(
    app.db.transaction((tx) =>
      bindAttachments(tx, {
        teamId,
        projectId,
        targetType: 'requirement',
        targetId: requirementId,
        attachmentIds: [uploaded.attachment.id],
        actor: { userId: teamAdmin.userId },
        policy: bindingPolicy,
      }),
    ),
    /只能绑定本人上传的临时附件/,
  )
  await app.db.transaction((tx) =>
    bindAttachments(tx, {
      teamId,
      projectId,
      targetType: 'requirement',
      targetId: requirementId,
      attachmentIds: [uploaded.attachment.id],
      actor: { userId: developer.userId },
      policy: bindingPolicy,
    }),
  )
  const summaries = await listAttachmentsForTarget(app.db, 'requirement', requirementId)
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0]?.id, uploaded.attachment.id)
  assert.equal(summaries[0]?.uploadedBy.userId, developer.userId)
  assert.equal(summaries[0]?.downloadUrl, `/api/v1/attachments/${uploaded.attachment.id}/download`)

  // 重复绑定同一附件必须冲突，不重复绑定。
  await assert.rejects(
    app.db.transaction((tx) =>
      bindAttachments(tx, {
        teamId,
        projectId,
        targetType: 'requirement',
        targetId: requirementId,
        attachmentIds: [uploaded.attachment.id],
        actor: { userId: developer.userId },
        policy: bindingPolicy,
      }),
    ),
    /不是待绑定的临时附件/,
  )

  // 下载：成员（含浏览者）拿到原始字节与校验头，下载文件名按 UTF-8 编码。
  for (const cookie of [developer.cookie, viewer.cookie]) {
    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${uploaded.attachment.id}/download`,
      headers: { cookie },
    })
    assert.equal(download.statusCode, 200, download.body)
    assert.equal(download.headers['content-type'], 'application/octet-stream')
    assert.equal(download.headers['x-content-sha256'], uploaded.attachment.sha256)
    assert.equal(download.headers['content-length'], String(uploaded.bytes.length))
    assert.match(String(download.headers['content-disposition']), /filename\*=UTF-8''/)
    assert.deepEqual(download.rawPayload, uploaded.bytes)
  }

  // 跨团队用户下载被拒绝，且返回业务信封。
  const outsiderDownload = await app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${uploaded.attachment.id}/download`,
    headers: { cookie: outsider.cookie },
  })
  assert.equal(outsiderDownload.json().code, 'FORBIDDEN')

  // 跨项目绑定被拒绝：附件临时态但属于另一个项目。
  const crossProjectTemp = await uploadSucceeded(developer.cookie, '跨项目.txt')
  const otherTeamRequirementId = randomUUID()
  await assert.rejects(
    app.db.transaction((tx) =>
      bindAttachments(tx, {
        teamId: otherTeamId,
        projectId: otherProjectId,
        targetType: 'requirement',
        targetId: otherTeamRequirementId,
        attachmentIds: [crossProjectTemp.attachment.id],
        actor: { userId: developer.userId },
        policy: bindingPolicy,
      }),
    ),
    /附件不属于当前项目/,
  )

  // 上传权限：浏览者与其他团队成员均不可上传；项目不存在返回 NOT_FOUND。
  const viewerUpload = await uploadAttachment({ cookie: viewer.cookie })
  assert.equal(viewerUpload.response.json().code, 'FORBIDDEN')
  const outsiderUpload = await uploadAttachment({ cookie: outsider.cookie })
  assert.equal(outsiderUpload.response.json().code, 'FORBIDDEN')
  const missingProjectUpload = await uploadAttachment({
    cookie: developer.cookie,
    projectId: '00000000-0000-4000-8000-000000009999',
  })
  assert.equal(missingProjectUpload.response.json().code, 'NOT_FOUND')

  // 非法文件名、缺失文件名、零字节与超限。
  const missingName = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/attachments`,
    payload: Buffer.from('x'),
    headers: { cookie: developer.cookie, 'content-type': 'application/octet-stream', 'content-length': '1' },
  })
  assert.equal(missingName.json().code, 'ATTACHMENT_INVALID')
  const unsafeName = await uploadAttachment({ cookie: developer.cookie, fileName: '../etc/passwd' })
  assert.equal(unsafeName.response.json().code, 'ATTACHMENT_INVALID')
  const zeroBytes = await uploadAttachment({ cookie: developer.cookie, bytes: Buffer.alloc(0) })
  assert.equal(zeroBytes.response.json().code, 'ATTACHMENT_INVALID')
  const overLimit = await uploadAttachment({
    cookie: developer.cookie,
    bytes: randomBytes(MAX_FILE_BYTES + 1),
  })
  assert.equal(overLimit.response.json().code, 'ATTACHMENT_LIMIT_EXCEEDED')

  // 缺少 Content-Length 的流式请求无法声明大小，直接拒绝。
  const chunkedUpload = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/attachments`,
    payload: Readable.from([Buffer.from('chunked body')]),
    headers: {
      cookie: developer.cookie,
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('分块.txt'),
    },
  })
  assert.equal(chunkedUpload.json().code, 'ATTACHMENT_INVALID')

  // 上传路由跳过全局幂等钩子：带 Idempotency-Key 的上传成功且不登记幂等记录。
  const idempotentUpload = await uploadAttachment({
    cookie: developer.cookie,
    fileName: '幂等.txt',
    headers: { 'idempotency-key': `upload-${randomUUID()}` },
  })
  assert.equal(idempotentUpload.response.json().success, true)
  const idempotencyRecords = await app.db.select().from(idempotencyRecord)
  assert.equal(idempotencyRecords.length, 0)

  // 临时附件超期后不可绑定。
  const expired = await uploadSucceeded(developer.cookie, '过期.txt')
  await app.db
    .update(attachment)
    .set({ created_at: new Date(Date.now() - (TEMP_TTL_HOURS + 1) * 60 * 60 * 1000) })
    .where(eq(attachment.id, expired.attachment.id))
  await assert.rejects(
    app.db.transaction((tx) =>
      bindAttachments(tx, {
        teamId,
        projectId,
        targetType: 'requirement',
        targetId: requirementId,
        attachmentIds: [expired.attachment.id],
        actor: { userId: developer.userId },
        policy: bindingPolicy,
      }),
    ),
    /超过保留期/,
  )
  // 恢复创建时间，避免后续清理用例把它当作超期临时附件重复统计。
  await app.db.update(attachment).set({ created_at: new Date() }).where(eq(attachment.id, expired.attachment.id))

  // 单次/单记录数量上限。
  const limitPolicy = { maxFilesPerSubmit: 1, maxFilesPerRecord: 1, tempRetentionHours: TEMP_TTL_HOURS }
  const firstLimited = await uploadSucceeded(developer.cookie, '上限一.txt')
  const secondLimited = await uploadSucceeded(developer.cookie, '上限二.txt')
  await assert.rejects(
    app.db.transaction((tx) =>
      bindAttachments(tx, {
        teamId,
        projectId,
        targetType: 'requirement',
        targetId: requirementId,
        attachmentIds: [firstLimited.attachment.id, secondLimited.attachment.id],
        actor: { userId: developer.userId },
        policy: limitPolicy,
      }),
    ),
    /单次最多提交 1 个附件/,
  )

  // 删除权限矩阵（已绑定附件）：浏览者、非上传者开发者拒绝；项目负责人与团队管理员可删除。
  const removable = await uploadSucceeded(developer.cookie, '待删除.txt')
  await app.db.transaction((tx) =>
    bindAttachments(tx, {
      teamId,
      projectId,
      targetType: 'requirement',
      targetId: requirementId,
      attachmentIds: [removable.attachment.id],
      actor: { userId: developer.userId },
      policy: bindingPolicy,
    }),
  )
  async function removeAttachmentRequest(attachmentId: string, cookie: string) {
    return app
      .inject({
        method: 'POST',
        url: `/api/v1/attachments/${attachmentId}/remove`,
        headers: { cookie },
      })
      .then((response) => response.json())
  }
  assert.equal((await removeAttachmentRequest(removable.attachment.id, viewer.cookie)).code, 'FORBIDDEN')
  assert.equal((await removeAttachmentRequest(removable.attachment.id, otherDeveloper.cookie)).code, 'FORBIDDEN')
  const ownerRemove = await removeAttachmentRequest(removable.attachment.id, projectOwner.cookie)
  assert.equal(ownerRemove.success, true, JSON.stringify(ownerRemove))
  assert.equal(ownerRemove.data.removed, true)
  assert.equal((await removeAttachmentRequest(removable.attachment.id, teamAdmin.cookie)).code, 'ATTACHMENT_NOT_FOUND')

  const ownRemovable = await uploadSucceeded(developer.cookie, '本人删除.txt')
  const removed = await removeAttachmentRequest(ownRemovable.attachment.id, developer.cookie)
  assert.deepEqual(removed.data, { id: ownRemovable.attachment.id, removed: true })
  const removedDownload = await app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${ownRemovable.attachment.id}/download`,
    headers: { cookie: developer.cookie },
  })
  assert.equal(removedDownload.json().code, 'ATTACHMENT_NOT_FOUND')
  assert.equal(
    (await removeAttachmentRequest(ownRemovable.attachment.id, developer.cookie)).code,
    'ATTACHMENT_NOT_FOUND',
  )

  // 解绑：最终集合中缺失的附件置为 removed，且删除他人附件需要删除权限。
  const ownedByDeveloper = await uploadSucceeded(developer.cookie, '解绑一.txt')
  const ownedByAdmin = await uploadSucceeded(teamAdmin.cookie, '解绑二.txt')
  await app.db.transaction((tx) =>
    bindAttachments(tx, {
      teamId,
      projectId,
      targetType: 'requirement',
      targetId: requirementId,
      attachmentIds: [ownedByDeveloper.attachment.id],
      actor: { userId: developer.userId },
      policy: bindingPolicy,
    }),
  )
  await app.db.transaction((tx) =>
    bindAttachments(tx, {
      teamId,
      projectId,
      targetType: 'requirement',
      targetId: requirementId,
      attachmentIds: [ownedByAdmin.attachment.id],
      actor: { userId: teamAdmin.userId },
      policy: bindingPolicy,
    }),
  )
  await assert.rejects(
    app.db.transaction((tx) =>
      unbindAttachments(tx, {
        teamId,
        projectId,
        targetType: 'requirement',
        targetId: requirementId,
        keepAttachmentIds: [ownedByDeveloper.attachment.id],
        actor: { userId: developer.userId },
      }),
    ),
    /无权删除他人上传的附件/,
  )
  await app.db.transaction((tx) =>
    unbindAttachments(tx, {
      teamId,
      projectId,
      targetType: 'requirement',
      targetId: requirementId,
      keepAttachmentIds: [],
      actor: { userId: teamAdmin.userId },
    }),
  )
  const remaining = await listAttachmentsForTarget(app.db, 'requirement', requirementId)
  assert.equal(remaining.length, 0)

  // 清理任务：temp 超期记录与对象一起删除；removed 记录重试删除对象后清理记录。
  const cleanupStorage = createStorageService({
    db: app.db,
    cipher: null,
    config: { localDir: storageFixture.rootDir, probeTimeoutMs: config.STORAGE_PROBE_TIMEOUT_MS },
  })
  const cleanupTask = createAttachmentCleanup({
    db: app.db,
    storage: cleanupStorage,
    policy: { tempRetentionHours: TEMP_TTL_HOURS },
    log: () => undefined,
  })

  const expiredTemp = await uploadSucceeded(developer.cookie, '清理临时.txt')
  const [expiredTempRow] = await app.db.select().from(attachment).where(eq(attachment.id, expiredTemp.attachment.id))
  assert.ok(expiredTempRow)
  const expiredTempPath = join(storageFixture.rootDir, expiredTempRow.storage_key)
  assert.equal((await stat(expiredTempPath)).isFile(), true)
  await app.db
    .update(attachment)
    .set({ created_at: new Date(Date.now() - (TEMP_TTL_HOURS + 1) * 60 * 60 * 1000) })
    .where(eq(attachment.id, expiredTemp.attachment.id))

  const removedCandidateId = randomUUID()
  const removedStorageKey = `attachments/${teamId}/${projectId}/${removedCandidateId}`
  const removedPath = join(storageFixture.rootDir, removedStorageKey)
  const removedBytes = Buffer.from('待清理对象')
  const removedAdapter = await cleanupStorage.adapterForBucketId(expiredTempRow.bucket_id)
  await removedAdapter.put(removedStorageKey, Readable.from([removedBytes]), removedBytes.length)
  await app.db.insert(attachment).values({
    id: removedCandidateId,
    team_id: teamId,
    project_id: projectId,
    bucket_id: expiredTempRow.bucket_id,
    storage_key: removedStorageKey,
    file_name: '待清理.txt',
    size_bytes: removedBytes.length,
    content_type: 'text/plain',
    sha256: createHash('sha256').update(removedBytes).digest('hex'),
    status: 'removed',
    target_type: 'requirement',
    target_id: requirementId,
    uploaded_by_user_id: developer.userId,
    bound_at: new Date(),
  })

  const removedBeforeCleanup = await app.db
    .select({ id: attachment.id, name: attachment.file_name })
    .from(attachment)
    .where(eq(attachment.status, 'removed'))
  const cleanupResult = await cleanupTask.runOnce()
  assert.equal(cleanupResult.expiredTempAttachments, 1)
  assert.equal(cleanupResult.removedAttachments, removedBeforeCleanup.length, JSON.stringify(removedBeforeCleanup))
  assert.equal(cleanupResult.failures, 0)

  const [expiredTempAfter] = await app.db.select().from(attachment).where(eq(attachment.id, expiredTemp.attachment.id))
  assert.equal(expiredTempAfter, undefined)
  await assert.rejects(stat(expiredTempPath), /ENOENT/)
  const [removedAfter] = await app.db.select().from(attachment).where(eq(attachment.id, removedCandidateId))
  assert.equal(removedAfter, undefined)
  await assert.rejects(stat(removedPath), /ENOENT/)

  // 附件上传、绑定、移除均写入团队活动流，实体类型固定为 attachment。
  const attachmentActivities = await app.db
    .select({ action: activity.action, entityType: activity.entity_type })
    .from(activity)
    .where(and(eq(activity.team_id, teamId), eq(activity.entity_type, 'attachment')))
  const actions = new Set(attachmentActivities.map((row) => row.action))
  for (const expected of ['attachment_uploaded', 'attachment_bound', 'attachment_removed']) {
    assert.equal(actions.has(expected), true, `缺少附件活动：${expected}`)
  }
})
