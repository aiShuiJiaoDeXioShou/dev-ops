import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { and, eq } from 'drizzle-orm'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { BUILTIN_LOCAL_BUCKET_ID, storageBucket, storageBucketEvent } from '../../src/modules/storage/storage.tables.ts'
import { attachment } from '../../src/modules/attachments/attachments.tables.ts'
import { platformAdmin, team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { createAttachmentStorageFixture } from '../support/attachment-storage.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

/** 不可达的接入地址；连接会被立即拒绝，避免探测用例长时间等待。 */
const UNREACHABLE_ENDPOINT = 'http://127.0.0.1:1'

test('储存桶管理：权限、唯一性、默认桶、引用保护与审计', { timeout: 120_000 }, async (t) => {
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
    GIT_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ATTACHMENT_STORAGE_DIR: storageFixture.rootDir,
    STORAGE_PROBE_TIMEOUT_MS: '2000',
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })

  const platformUser = await createAuthenticatedUser(app, { name: '平台管理员' })
  const normalUser = await createAuthenticatedUser(app, { name: '普通成员' })
  await app.db.insert(platformAdmin).values({ user_id: platformUser.userId })

  async function request(input: {
    method: 'GET' | 'POST'
    url: string
    cookie: string
    payload?: string | Buffer | Record<string, unknown>
  }) {
    const response = await app.inject({
      method: input.method,
      url: input.url,
      headers: { cookie: input.cookie },
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    })
    assert.equal(response.statusCode, 200, response.body)
    const body: unknown = response.json()
    assert.ok(typeof body === 'object' && body !== null)
    return body as { success: boolean; code: string; message: string; data?: unknown }
  }

  async function adminPost(url: string, payload?: Record<string, unknown>) {
    return request({ method: 'POST', url, cookie: platformUser.cookie, payload })
  }

  async function adminGet(url: string) {
    return request({ method: 'GET', url, cookie: platformUser.cookie })
  }

  type BucketView = {
    id: string
    name: string
    kind: string
    isBuiltin: boolean
    isDefault: boolean
    status: string
    endpoint: string | null
    bucketName: string | null
    region: string | null
    pathPrefix: string | null
    accessKeyHint: string | null
    lastProbe: { result: string; message: string | null; at: string | null } | null
    version: number
    updatedAt: string
  }

  async function listBuckets(): Promise<BucketView[]> {
    const body = await adminGet('/api/v1/platform/storage-buckets')
    assert.equal(body.success, true)
    const data = body.data as { buckets: BucketView[] }
    return data.buckets
  }

  async function createBucket(input: {
    name: string
    endpoint?: string
    bucketName?: string
    region?: string
    pathPrefix?: string | null
    accessKeyId?: string
    secretAccessKey?: string
    setAsDefault?: boolean
  }) {
    return adminPost('/api/v1/platform/storage-buckets', {
      name: input.name,
      kind: 's3',
      endpoint: input.endpoint ?? UNREACHABLE_ENDPOINT,
      bucketName: input.bucketName ?? 'attachments',
      ...(input.region === undefined ? {} : { region: input.region }),
      ...(input.pathPrefix === undefined ? {} : { pathPrefix: input.pathPrefix }),
      accessKeyId: input.accessKeyId ?? 'AKIATESTKEY0001',
      secretAccessKey: input.secretAccessKey ?? 'super-secret-value',
      ...(input.setAsDefault === undefined ? {} : { setAsDefault: input.setAsDefault }),
    })
  }

  async function bucketRow(bucketId: string) {
    const [row] = await app.db.select().from(storageBucket).where(eq(storageBucket.id, bucketId)).limit(1)
    assert.ok(row, '储存桶记录应存在')
    return row
  }

  // 权限兜底：非平台管理员不能读取或创建桶。
  const forbiddenList = await request({
    method: 'GET',
    url: '/api/v1/platform/storage-buckets',
    cookie: normalUser.cookie,
  })
  assert.equal(forbiddenList.success, false)
  assert.equal(forbiddenList.code, 'FORBIDDEN')
  const forbiddenCreate = await request({
    method: 'POST',
    url: '/api/v1/platform/storage-buckets',
    cookie: normalUser.cookie,
    payload: {
      name: '越权桶',
      kind: 's3',
      endpoint: UNREACHABLE_ENDPOINT,
      bucketName: 'attachments',
      accessKeyId: 'AKIATESTKEY0001',
      secretAccessKey: 'super-secret-value',
    },
  })
  assert.equal(forbiddenCreate.code, 'FORBIDDEN')

  // 列表默认只含内置本地桶，且响应不含任何凭据列。
  const initialBuckets = await listBuckets()
  assert.equal(initialBuckets.length, 1)
  const builtin = initialBuckets[0]
  assert.ok(builtin)
  assert.equal(builtin.id, BUILTIN_LOCAL_BUCKET_ID)
  assert.equal(builtin.kind, 'local')
  assert.equal(builtin.isBuiltin, true)
  assert.equal(builtin.isDefault, true)
  assert.equal(builtin.endpoint, null)
  assert.equal(builtin.accessKeyHint, null)
  const rawList = await adminGet('/api/v1/platform/storage-buckets')
  const rawJson = JSON.stringify(rawList)
  assert.equal(rawJson.includes('credential'), false)
  assert.equal(rawJson.includes('secretAccessKey'), false)

  // 内置桶连接测试使用真实本地目录，结论为可读写。
  const builtinProbe = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/test`)
  assert.equal(builtinProbe.success, true)
  assert.equal((builtinProbe.data as { result: string }).result, 'read_write')

  // 创建 S3 桶：只返回掩码；响应不含完整 Access Key 与 Secret。
  const created = await createBucket({ name: '对象存储 A', pathPrefix: '/env/test/' })
  assert.equal(created.success, true, JSON.stringify(created))
  const bucketA = created.data as BucketView
  assert.equal(bucketA.kind, 's3')
  assert.equal(bucketA.isDefault, false)
  assert.equal(bucketA.status, 'enabled')
  assert.equal(bucketA.endpoint, UNREACHABLE_ENDPOINT)
  assert.equal(bucketA.pathPrefix, 'env/test')
  assert.equal(bucketA.accessKeyHint, 'AKIA****0001')
  assert.equal(bucketA.lastProbe, null)
  const createdJson = JSON.stringify(created)
  assert.equal(createdJson.includes('super-secret-value'), false)
  assert.equal(createdJson.includes('AKIATESTKEY0001'), false)
  assert.equal(createdJson.includes('credential_ciphertext'), false)
  const storedA = await bucketRow(bucketA.id)
  assert.ok(storedA.credential_ciphertext)
  assert.notEqual(storedA.credential_ciphertext, 'super-secret-value')

  // 名称唯一：创建与改名都返回专用错误码。
  const duplicate = await createBucket({ name: '对象存储 A' })
  assert.equal(duplicate.success, false)
  assert.equal(duplicate.code, 'STORAGE_BUCKET_NAME_CONFLICT')
  const renameConflict = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: bucketA.version,
    name: '本地储存',
  })
  assert.equal(renameConflict.success, false)
  assert.equal(renameConflict.code, 'STORAGE_BUCKET_NAME_CONFLICT')

  // 版本乐观锁：过期版本必须冲突。
  const staleUpdate = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: 99,
    name: '对象存储 A-过期',
  })
  assert.equal(staleUpdate.success, false)
  assert.equal(staleUpdate.code, 'VERSION_CONFLICT')

  // 改名成功；secretAccessKey 省略时密文原样保留。
  const renamed = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: bucketA.version,
    name: '对象存储 A2',
  })
  assert.equal(renamed.success, true, JSON.stringify(renamed))
  const bucketA2 = renamed.data as BucketView
  assert.equal(bucketA2.name, '对象存储 A2')
  assert.equal(bucketA2.version, bucketA.version + 1)
  assert.equal(bucketA2.accessKeyHint, 'AKIA****0001')
  const afterRename = await bucketRow(bucketA.id)
  assert.equal(afterRename.credential_ciphertext, storedA.credential_ciphertext)
  assert.equal(afterRename.credential_iv, storedA.credential_iv)

  // 同时提供新 Access Key 与 Secret 才允许轮换；只给其中一个被拒绝。
  const partialCredentials = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: bucketA2.version,
    accessKeyId: 'AKIAOTHERKEY9999',
  })
  assert.equal(partialCredentials.success, false)
  assert.equal(partialCredentials.code, 'VALIDATION_ERROR')
  const rotated = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: bucketA2.version,
    accessKeyId: 'AKIAOTHERKEY9999',
    secretAccessKey: 'rotated-secret-value',
  })
  assert.equal(rotated.success, true, JSON.stringify(rotated))
  const bucketA3 = rotated.data as BucketView
  assert.equal(bucketA3.accessKeyHint, 'AKIA****9999')
  assert.equal(bucketA3.version, bucketA2.version + 1)
  assert.equal(JSON.stringify(rotated).includes('rotated-secret-value'), false)
  const afterRotate = await bucketRow(bucketA.id)
  assert.notEqual(afterRotate.credential_ciphertext, afterRename.credential_ciphertext)

  // 内置桶保护：只允许改名；改接入参数或状态被拒绝；内置桶不可删除。
  const builtinRename = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/update`, {
    version: builtin.version,
    name: '本地储存（内置）',
  })
  assert.equal(builtinRename.success, true, JSON.stringify(builtinRename))
  const builtinRenamed = builtinRename.data as BucketView
  const builtinEndpoint = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/update`, {
    version: builtinRenamed.version,
    endpoint: 'http://127.0.0.1:9000',
  })
  assert.equal(builtinEndpoint.code, 'STORAGE_BUCKET_BUILTIN_PROTECTED')
  const builtinDisable = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/update`, {
    version: builtinRenamed.version,
    status: 'disabled',
  })
  assert.equal(builtinDisable.code, 'STORAGE_BUCKET_BUILTIN_PROTECTED')
  const builtinRemove = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/remove`)
  assert.equal(builtinRemove.code, 'STORAGE_BUCKET_BUILTIN_PROTECTED')

  // 连接测试：不可达地址归因为 unreachable，并持久化最近探测结论。
  const probe = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/test`)
  assert.equal(probe.success, true, JSON.stringify(probe))
  const probeData = probe.data as { result: string; message: string; checkedAt: string }
  assert.equal(probeData.result, 'unreachable')
  assert.ok(probeData.message.length > 0)
  assert.equal(Number.isNaN(Date.parse(probeData.checkedAt)), false)
  const probedRow = await bucketRow(bucketA.id)
  assert.equal(probedRow.last_probe_result, 'unreachable')
  assert.equal(probedRow.last_probed_at instanceof Date, true)
  const listAfterProbe = await listBuckets()
  assert.equal(listAfterProbe.find((bucket) => bucket.id === bucketA.id)?.lastProbe?.result, 'unreachable')

  // 未通过可读写测试的桶不能设为默认。
  const notWritable = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/set-default`, {
    version: bucketA3.version,
  })
  assert.equal(notWritable.success, false)
  assert.equal(notWritable.code, 'STORAGE_BUCKET_NOT_WRITABLE')

  // 模拟探测通过后设为默认；原默认桶自动取消，单默认桶不变量保持。
  await app.db
    .update(storageBucket)
    .set({ last_probe_result: 'read_write', last_probe_message: '储存桶可读写', last_probed_at: new Date() })
    .where(eq(storageBucket.id, bucketA.id))
  const setDefault = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/set-default`, {
    version: bucketA3.version,
  })
  assert.equal(setDefault.success, true, JSON.stringify(setDefault))
  const defaultView = setDefault.data as BucketView
  assert.equal(defaultView.isDefault, true)
  const bucketsAfterDefault = await listBuckets()
  assert.equal(bucketsAfterDefault[0]?.id, BUILTIN_LOCAL_BUCKET_ID)
  assert.equal(bucketsAfterDefault[1]?.id, bucketA.id)
  assert.equal(bucketsAfterDefault.filter((bucket) => bucket.isDefault).length, 1)
  const defaultRows = await app.db.select().from(storageBucket).where(eq(storageBucket.is_default, true))
  assert.equal(defaultRows.length, 1)
  assert.equal(defaultRows[0]?.id, bucketA.id)

  // 当前默认桶不能停用或删除，必须显式切换。
  const disableDefault = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: defaultView.version,
    status: 'disabled',
  })
  assert.equal(disableDefault.code, 'STORAGE_BUCKET_NOT_WRITABLE')
  const removeDefault = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/remove`)
  assert.equal(removeDefault.code, 'STORAGE_BUCKET_NOT_WRITABLE')

  // setAsDefault=true 但探测未通过时拒绝创建，不留下半成品配置。
  const listBeforeFailedCreate = await listBuckets()
  const failedCreate = await createBucket({ name: '对象存储 D', setAsDefault: true })
  assert.equal(failedCreate.success, false)
  assert.equal(failedCreate.code, 'STORAGE_BUCKET_NOT_WRITABLE')
  const listAfterFailedCreate = await listBuckets()
  assert.equal(listAfterFailedCreate.length, listBeforeFailedCreate.length)

  // 切回内置桶默认；内置桶天然满足可读写。
  const builtinDefault = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/set-default`, {
    version: builtinRenamed.version,
  })
  assert.equal(builtinDefault.success, true, JSON.stringify(builtinDefault))
  const builtinAfterDefault = builtinDefault.data as BucketView
  assert.equal(builtinAfterDefault.isDefault, true)
  assert.equal((await listBuckets()).filter((bucket) => bucket.isDefault).length, 1)

  // 引用中的桶不能删除或停用；错误消息与 data 带引用数量。
  const attachmentId = randomUUID()
  await app.db.insert(attachment).values({
    id: attachmentId,
    team_id: randomUUID(),
    project_id: randomUUID(),
    bucket_id: bucketA.id,
    storage_key: `attachments/${attachmentId}`,
    file_name: '证据.txt',
    size_bytes: 4,
    sha256: '0'.repeat(64),
    status: 'temp',
    uploaded_by_user_id: platformUser.userId,
  })
  const inUseRemove = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/remove`)
  assert.equal(inUseRemove.success, false)
  assert.equal(inUseRemove.code, 'STORAGE_BUCKET_IN_USE')
  assert.match(inUseRemove.message, /1/)
  assert.deepEqual(inUseRemove.data, { attachmentCount: 1 })
  const inUseDisable = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/update`, {
    version: defaultView.version + 1,
    status: 'disabled',
  })
  assert.equal(inUseDisable.code, 'STORAGE_BUCKET_IN_USE')

  // 清理引用后允许删除；删除写入审计并保留事件。
  await app.db.delete(attachment).where(eq(attachment.id, attachmentId))
  const removedA = await adminPost(`/api/v1/platform/storage-buckets/${bucketA.id}/remove`)
  assert.equal(removedA.success, true, JSON.stringify(removedA))
  assert.deepEqual(removedA.data, { id: bucketA.id, removed: true })
  assert.equal(
    (await listBuckets()).some((bucket) => bucket.id === bucketA.id),
    false,
  )

  // 未被引用的普通桶可直接删除。
  const createdC = await createBucket({ name: '对象存储 C' })
  const bucketC = createdC.data as BucketView
  const removedC = await adminPost(`/api/v1/platform/storage-buckets/${bucketC.id}/remove`)
  assert.equal(removedC.success, true, JSON.stringify(removedC))

  // 审计：动作齐全、保留删除后的历史、且不含凭据明文或密文。
  const events = await app.db
    .select()
    .from(storageBucketEvent)
    .where(and(eq(storageBucketEvent.bucket_id, bucketA.id)))
  const actions = new Set(events.map((event) => event.action))
  for (const expected of [
    'bucket_created',
    'bucket_updated',
    'bucket_probed',
    'bucket_set_default',
    'bucket_removed',
  ]) {
    assert.equal(actions.has(expected), true, `缺少审计动作 ${expected}`)
  }
  const auditJson = JSON.stringify(events)
  assert.equal(auditJson.includes('super-secret-value'), false)
  assert.equal(auditJson.includes('rotated-secret-value'), false)
  assert.equal(auditJson.includes('AKIATESTKEY0001'), false)
  assert.equal(auditJson.includes('AKIAOTHERKEY9999'), false)
  const rotatedCiphertext = afterRotate.credential_ciphertext
  assert.ok(rotatedCiphertext)
  assert.equal(auditJson.includes(rotatedCiphertext), false)
  const credentialEvent = events.find(
    (event) => event.action === 'bucket_updated' && event.changes?.accessKeyId !== undefined,
  )
  assert.ok(credentialEvent, '应存在凭据变更审计')
  assert.equal(credentialEvent.changes?.accessKeyId, '***')
  assert.equal(credentialEvent.changes?.secretAccessKey, '***')
  assert.equal(credentialEvent.changes?.accessKeyHint, 'AKIA****9999')

  // 删除桶后事件保留，且列表不再返回该桶。
  assert.ok(events.length >= 5)

  // 可选真实验证：本机 MinIO 可用时验证 S3 兼容链路；不可用时显式标注未验证。
  const minioEndpoint = process.env.STORAGE_TEST_MINIO_ENDPOINT ?? 'http://127.0.0.1:9000'
  const minioAccessKey = process.env.STORAGE_TEST_MINIO_ACCESS_KEY ?? 'minioadmin'
  const minioSecretKey = process.env.STORAGE_TEST_MINIO_SECRET_KEY ?? 'minioadmin'
  const minioClient = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: minioAccessKey, secretAccessKey: minioSecretKey },
    requestHandler: { connectionTimeout: 2_000, requestTimeout: 2_000, throwOnRequestTimeout: true },
  })
  cleanup.push(async () => {
    minioClient.destroy()
  })
  let minioAvailable = false
  try {
    await minioClient.send(new ListBucketsCommand({}))
    minioAvailable = true
  } catch {
    minioAvailable = false
  }
  if (!minioAvailable) {
    t.diagnostic(`MinIO 真实验证未执行：${minioEndpoint} 不可达或凭据不可用，S3 兼容链路保持未验证`)
  } else {
    const minioBucketName = `dev-ops-test-${randomBytes(4).toString('hex')}`
    await minioClient.send(new CreateBucketCommand({ Bucket: minioBucketName }))
    cleanup.push(async () => {
      await minioClient.send(new DeleteBucketCommand({ Bucket: minioBucketName }))
    })
    const minioCreated = await createBucket({
      name: 'MinIO 真实验证桶',
      endpoint: minioEndpoint,
      bucketName: minioBucketName,
      accessKeyId: minioAccessKey,
      secretAccessKey: minioSecretKey,
    })
    assert.equal(minioCreated.success, true, JSON.stringify(minioCreated))
    const minioBucket = minioCreated.data as BucketView
    const minioProbe = await adminPost(`/api/v1/platform/storage-buckets/${minioBucket.id}/test`)
    assert.equal(minioProbe.success, true, JSON.stringify(minioProbe))
    assert.equal((minioProbe.data as { result: string }).result, 'read_write')
    // 探测结论已持久化，再次读取可见。
    const minioListed = (await listBuckets()).find((bucket) => bucket.id === minioBucket.id)
    assert.equal(minioListed?.lastProbe?.result, 'read_write')
    // 端到端：切默认到 S3 后上传附件应写入新桶，下载内容一致；切回本地后历史附件仍可下载。
    const minioTeamId = randomUUID()
    const minioProjectId = randomUUID()
    await app.db.insert(team).values({
      id: minioTeamId,
      name: `minio-team-${randomBytes(3).toString('hex')}`,
      created_by_user_id: normalUser.userId,
    })
    await app.db.insert(teamMember).values({
      id: randomUUID(),
      team_id: minioTeamId,
      user_id: normalUser.userId,
      role: 'admin',
      status: 'active',
    })
    await app.db.insert(project).values({
      id: minioProjectId,
      team_id: minioTeamId,
      name: 'MinIO 附件项目',
      owner_user_id: normalUser.userId,
      created_by_user_id: normalUser.userId,
    })
    const minioVersion = (await listBuckets()).find((bucket) => bucket.id === minioBucket.id)?.version
    assert.ok(minioVersion)
    const minioDefault = await adminPost(`/api/v1/platform/storage-buckets/${minioBucket.id}/set-default`, {
      version: minioVersion,
    })
    assert.equal(minioDefault.success, true, JSON.stringify(minioDefault))
    const minioBytes = Buffer.from('minio attachment body', 'utf8')
    const minioUpload = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${minioProjectId}/attachments`,
      headers: {
        cookie: normalUser.cookie,
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('minio-附件.txt'),
        'content-length': String(minioBytes.length),
      },
      payload: minioBytes,
    })
    assert.equal(minioUpload.statusCode, 200, minioUpload.body)
    const minioUploadBody = minioUpload.json()
    assert.equal(minioUploadBody.success, true, minioUpload.body)
    const minioAttachmentId = minioUploadBody.data.attachment.id as string
    const [minioAttachmentRow] = await app.db.select().from(attachment).where(eq(attachment.id, minioAttachmentId))
    assert.ok(minioAttachmentRow)
    assert.equal(minioAttachmentRow.bucket_id, minioBucket.id)
    await minioClient.send(new HeadObjectCommand({ Bucket: minioBucketName, Key: minioAttachmentRow.storage_key }))
    const minioDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${minioAttachmentId}/download`,
      headers: { cookie: normalUser.cookie },
    })
    assert.equal(minioDownload.statusCode, 200, minioDownload.body)
    assert.deepEqual(minioDownload.rawPayload, minioBytes)
    const builtinVersion = (await listBuckets()).find((bucket) => bucket.id === BUILTIN_LOCAL_BUCKET_ID)?.version
    assert.ok(builtinVersion)
    const backToBuiltin = await adminPost(`/api/v1/platform/storage-buckets/${BUILTIN_LOCAL_BUCKET_ID}/set-default`, {
      version: builtinVersion,
    })
    assert.equal(backToBuiltin.success, true, JSON.stringify(backToBuiltin))
    const historicalDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${minioAttachmentId}/download`,
      headers: { cookie: normalUser.cookie },
    })
    assert.equal(historicalDownload.statusCode, 200, historicalDownload.body)
    assert.deepEqual(historicalDownload.rawPayload, minioBytes)
    const minioRemoveAttachment = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${minioAttachmentId}/remove`,
      headers: { cookie: normalUser.cookie },
    })
    assert.equal(minioRemoveAttachment.json().success, true, minioRemoveAttachment.body)
    t.diagnostic('MinIO 端到端通过：设默认→上传写入 S3→下载一致→切回本地后历史可下载')
    const minioRemoved = await adminPost(`/api/v1/platform/storage-buckets/${minioBucket.id}/remove`)
    assert.equal(minioRemoved.success, true, JSON.stringify(minioRemoved))
    t.diagnostic(`MinIO 真实验证通过：${minioEndpoint} 写入、读回、删除均成功`)
  }
})
