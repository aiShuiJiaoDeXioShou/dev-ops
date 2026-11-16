import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { gitRepository, projectRepository } from '../../src/modules/code/code.tables.ts'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.ts'
import { runProjectFileCleanup } from '../../src/modules/projects/projects.file-cleanup.ts'
import { projectFileCleanup } from '../../src/modules/projects/projects.lifecycle.tables.ts'
import { attachment } from '../../src/modules/attachments/attachments.tables.ts'
import { pipelineArtifact, pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import { createPipelineStorage } from '../../src/modules/pipeline/pipeline.storage.ts'
import { createStorageService } from '../../src/modules/storage/storage.service.ts'
import { storageBucket } from '../../src/modules/storage/storage.tables.ts'
import { beginInvocation, completeInvocation, markInvocationRunning } from '../../src/modules/tools/tools.service.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('项目创建、筛选、版本冲突、权限、跨团队与活动记录', { timeout: 90_000 }, async (t) => {
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

  const files = await mkdtemp(join(tmpdir(), 'project-recycle-'))
  cleanup.push(() => rm(files, { recursive: true, force: true }))
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '1000',
    DB_LOCK_TIMEOUT_MS: '100',
    ATTACHMENT_STORAGE_DIR: join(files, 'attachments'),
    PIPELINE_STORAGE_DIR: join(files, 'pipeline'),
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

  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '内部平台', description: '说明' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(created.statusCode, 200, created.body)
  const project = created.json().data
  assert.equal(created.json().success, true)
  assert.equal(project.name, '内部平台')
  assert.equal(project.version, 1)
  assert.equal(project.owner.userId, adminUser.userId)
  assert.deepEqual(project.counts, { openRequirements: 0, openBugs: 0 })

  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/projects?search=平台&status=active`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(list.json().success, true)
  assert.equal(list.json().data.total, 1)

  const viewerCreate = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '浏览者不能创建' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const updated = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/update`,
    payload: { version: 1, name: '内部平台 v2', status: 'paused', statusReason: '等待排期' },
    headers: { cookie: devUser.cookie },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal(updated.json().data.version, 2)
  assert.equal(updated.json().data.name, '内部平台 v2')
  assert.equal(updated.json().data.status, 'paused')

  const conflict = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/update`,
    payload: { version: 1, name: '旧版本' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(conflict.json().code, 'VERSION_CONFLICT')

  const noReason = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/update`,
    payload: { version: 2, status: 'ended' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(noReason.json().code, 'VALIDATION_ERROR')

  await t.test('仓库选项去重，列表与晴雨表支持组合筛选', async () => {
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/projects`,
      payload: { name: '内部平台客户端', ownerUserId: devUser.userId },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(second.json().success, true, second.body)
    const secondId = second.json<{ data: { id: string } }>().data.id
    const unrelated = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/projects`,
      payload: { name: '其他项目' },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(unrelated.json().success, true, unrelated.body)
    const unrelatedId = unrelated.json<{ data: { id: string } }>().data.id

    const connectionId = randomUUID()
    const sharedId = randomUUID()
    const webId = randomUUID()
    await app.db.insert(gitConnection).values({
      id: connectionId,
      team_id: teamId,
      provider_key: 'gitea',
      auth_kind: 'gitea_token',
      instance_url: 'https://git.example.test',
      name: '团队 Gitea',
      created_by_user_id: adminUser.userId,
    })
    await app.db.insert(gitRepository).values(
      [
        { id: sharedId, name: 'core' },
        { id: webId, name: 'web' },
        { id: randomUUID(), name: 'unlinked' },
      ].map(({ id, name }) => ({
        id,
        team_id: teamId,
        connection_id: connectionId,
        provider_key: 'gitea',
        remote_repository_id: name,
        namespace: 'team',
        name,
        web_url: `https://git.example.test/team/${name}`,
      })),
    )
    await app.db.insert(projectRepository).values(
      [
        { projectId: project.id, repositoryId: sharedId },
        { projectId: secondId, repositoryId: sharedId },
        { projectId: secondId, repositoryId: webId },
      ].map(({ projectId, repositoryId }) => ({
        id: randomUUID(),
        team_id: teamId,
        project_id: projectId,
        repository_id: repositoryId,
        created_by_user_id: adminUser.userId,
      })),
    )

    const optionsPath = `/api/v1/teams/${teamId}/project-repositories`
    const options = await app.inject({ url: optionsPath, headers: { cookie: viewerUser.cookie } })
    assert.deepEqual(options.json().data.items, [
      { id: sharedId, namespace: 'team', name: 'core', providerKey: 'gitea', connectionName: '团队 Gitea' },
      { id: webId, namespace: 'team', name: 'web', providerKey: 'gitea', connectionName: '团队 Gitea' },
    ])
    const optionsPage = await app.inject({
      url: `${optionsPath}?page=2&pageSize=1`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(optionsPage.json().data.total, 2)
    assert.equal(optionsPage.json().data.items[0].id, webId)
    const denied = await app.inject({ url: optionsPath, headers: { cookie: otherUser.cookie } })
    assert.equal(denied.json().code, 'FORBIDDEN')

    const filterPath = `/api/v1/teams/${teamId}/projects?repositoryId=${sharedId}`
    const projectIds: string[] = []
    for (const page of [1, 2]) {
      const filtered = await app.inject({
        url: `${filterPath}&page=${page}&pageSize=1`,
        headers: { cookie: viewerUser.cookie },
      })
      const result = filtered.json<{ data: { total: number; items: Array<{ id: string }> } }>().data
      assert.equal(result.total, 2)
      assert.equal(result.items.length, 1)
      projectIds.push(...result.items.map((item) => item.id))
    }
    assert.deepEqual(new Set(projectIds), new Set([project.id, secondId]))
    const paused = await app.inject({
      url: `${filterPath}&status=paused&search=${encodeURIComponent('内部平台')}`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(paused.json().data.total, 1)
    assert.equal(paused.json().data.items[0].id, project.id)
    const dashboard = await app.inject({
      url: `/api/v1/teams/${teamId}/project-activity?repositoryId=${sharedId}&source=activity`,
      headers: { cookie: viewerUser.cookie },
    })
    const summary = dashboard.json<{ data: { projects: Array<{ projectId: string }> } }>().data.projects
    assert.deepEqual(new Set(summary.map((item) => item.projectId)), new Set(projectIds))

    for (const [query, expected] of [
      [`repositoryId=${sharedId}&status=active&ownerId=${devUser.userId}`, [secondId]],
      ['hasRepository=true', [project.id, secondId]],
      [`hasRepository=false&ownerId=${adminUser.userId}`, [unrelatedId]],
      [`hasRepository=false&repositoryId=${sharedId}`, []],
    ] as const) {
      const list = await app.inject({
        url: `/api/v1/teams/${teamId}/projects?${query}`,
        headers: { cookie: viewerUser.cookie },
      })
      const activity = await app.inject({
        url: `/api/v1/teams/${teamId}/project-activity?${query}&source=activity`,
        headers: { cookie: viewerUser.cookie },
      })
      const listData = list.json<{ data: { total: number; items: Array<{ id: string }> } }>().data
      const activityData = activity.json<{ data: { projects: Array<{ projectId: string }> } }>().data
      assert.equal(listData.total, expected.length, query)
      assert.deepEqual(new Set(listData.items.map((item) => item.id)), new Set(expected), query)
      assert.deepEqual(new Set(activityData.projects.map((item) => item.projectId)), new Set(expected), query)
    }
  })

  const stats = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project.id}/stats`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.deepEqual(stats.json().data, { openRequirements: 0, openBugs: 0 })

  const crossTeam = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project.id}`,
    headers: { cookie: otherUser.cookie },
  })
  assert.equal(crossTeam.json().code, 'FORBIDDEN')

  const activities = await app.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM app.activity WHERE entity_id = ${project.id}`,
  )
  assert.ok((activities.rows[0]?.count ?? 0) >= 2)

  await t.test('回收站按 ID 管理同名项目，清理失败可重试且保留记录', async () => {
    const sibling = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/projects`,
      payload: { name: '内部平台 v2' },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(sibling.json().success, true, sibling.body)
    const siblingId: string = sibling.json().data.id
    assert.notEqual(siblingId, project.id)
    const renameSibling = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${siblingId}/update`,
      payload: { version: 1, name: '内部平台' },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(renameSibling.json().success, true, renameSibling.body)
    const targetId: string = project.id
    const adminHeaders = { cookie: adminUser.cookie, origin: config.APP_ORIGIN }
    const devHeaders = { cookie: devUser.cookie, origin: config.APP_ORIGIN }
    const viewHeaders = { cookie: viewerUser.cookie }
    const post = (action: string, payload: object, headers = adminHeaders) =>
      app.inject({ method: 'POST', url: `/api/v1/projects/${targetId}/${action}`, headers, payload })
    const password = adminUser.password
    const recyclePath = `/api/v1/teams/${teamId}/project-recycle-bin`
    const readTarget = (path = '') => app.inject({ url: `/api/v1/projects/${targetId}${path}`, headers: viewHeaders })
    const readRecycle = (headers = adminHeaders) => app.inject({ url: recyclePath, headers })
    const rename = await post('update', { version: 2, name: '内部平台', ownerUserId: devUser.userId })
    assert.equal(rename.json().success, true, rename.body)
    const version: number = rename.json().data.version

    assert.equal(
      (await post('remove', { version, password }, { ...adminHeaders, cookie: viewerUser.cookie })).json().code,
      'FORBIDDEN',
    )
    assert.equal(
      (await post('remove', { version, password }, { ...adminHeaders, cookie: otherUser.cookie })).json().code,
      'FORBIDDEN',
    )
    assert.equal((await post('remove', { version, password: '错误密码' }, devHeaders)).json().code, 'PASSWORD_INVALID')
    assert.equal((await readRecycle(devHeaders)).json().code, 'FORBIDDEN')

    const child = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${targetId}/requirements`,
      headers: devHeaders,
      payload: { title: '回收站保留的需求', contentMode: 'markdown', contentMarkdown: '项目删除后保留' },
    })
    assert.equal(child.json().success, true, child.body)
    const childId: string = child.json().data.id

    const runId = randomUUID()
    const digest = 'a'.repeat(64)
    await app.db.insert(pipelineRun).values({
      id: runId,
      team_id: teamId,
      project_id: targetId,
      repository_id: randomUUID(),
      workflow_path: '.devops/workflows/verify.yaml',
      git_ref: 'main',
      commit_sha: 'a'.repeat(40),
      run_plan: {},
      workflow_snapshot: '',
      workflow_hash: digest,
      status: 'queued',
      trigger_source: 'manual',
      initiator_channel: 'web',
      triggered_by_user_id: devUser.userId,
      idempotency_key: randomUUID(),
      timeout_seconds: 60,
    })
    const blocked = await post('remove', { version, password: devUser.password }, devHeaders)
    assert.equal(blocked.json().code, 'PRECONDITION_FAILED')
    assert.deepEqual(blocked.json().data.blockers, ['流水线运行'])
    await app.db.update(pipelineRun).set({ status: 'succeeded' }).where(eq(pipelineRun.id, runId))
    const invocation = await beginInvocation(app.db, {
      teamId,
      projectId: targetId,
      capability: 'create_issue',
      channel: 'cli',
      idempotencyKey: randomUUID(),
      requestFingerprint: digest,
      inputSummary: {},
      createdByUserId: adminUser.userId,
    })
    assert.equal((await post('remove', { version, password })).json().code, 'PRECONDITION_FAILED')
    await markInvocationRunning(app.db, invocation.invocationId)
    await completeInvocation(app.db, invocation.invocationId, { status: 'failed' })

    const pipelineStorage = createPipelineStorage({
      rootDir: config.PIPELINE_STORAGE_DIR,
      maxArtifactBytes: config.PIPELINE_ARTIFACT_MAX_BYTES,
      maxLogChunkBytes: config.PIPELINE_LOG_CHUNK_MAX_BYTES,
    })
    const storage = createStorageService({
      db: app.db,
      cipher: null,
      config: { localDir: config.ATTACHMENT_STORAGE_DIR, probeTimeoutMs: config.STORAGE_PROBE_TIMEOUT_MS },
    })
    const [bucket] = await app.db.select({ id: storageBucket.id }).from(storageBucket).limit(1)
    assert.ok(bucket)
    const body = Buffer.from('保留元数据的文件')
    const hash = createHash('sha256').update(body).digest('hex')
    const attachmentId = randomUUID()
    const siblingAttachmentId = randomUUID()
    for (const { id, projectId } of [
      { id: attachmentId, projectId: targetId },
      { id: siblingAttachmentId, projectId: siblingId },
    ]) {
      const key = `attachments/${teamId}/${projectId}/${id}`
      const path = join(config.ATTACHMENT_STORAGE_DIR, key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      await app.db.insert(attachment).values({
        id,
        team_id: teamId,
        project_id: projectId,
        bucket_id: bucket.id,
        storage_key: key,
        file_name: '说明.txt',
        size_bytes: body.length,
        content_type: 'text/plain',
        sha256: hash,
        uploaded_by_user_id: devUser.userId,
        ...(projectId === targetId
          ? { status: 'bound', target_type: 'requirement', target_id: childId, bound_at: new Date() }
          : {}),
      })
    }
    const artifactId = randomUUID()
    const artifact = await pipelineStorage.writeArtifactStream(runId, artifactId, Readable.from([body]), hash)
    await app.db.insert(pipelineArtifact).values({
      id: artifactId,
      team_id: teamId,
      project_id: targetId,
      run_id: runId,
      step_index: 0,
      name: 'test',
      storage_key: artifact.storageKey,
      size_bytes: body.length,
      sha256: hash,
      status: 'available',
    })
    const log = await pipelineStorage.writeLogChunk(runId, 0, 0, '保留运行日志')

    const [removeResult, invocationResult] = await Promise.allSettled([
      post('remove', { version, password: devUser.password }, devHeaders),
      beginInvocation(app.db, {
        teamId,
        projectId: targetId,
        capability: 'create_issue',
        channel: 'cli',
        idempotencyKey: randomUUID(),
        requestFingerprint: digest,
        inputSummary: {},
        createdByUserId: devUser.userId,
      }),
    ])
    assert.equal(removeResult.status, 'fulfilled')
    if (invocationResult.status === 'fulfilled') {
      assert.equal(removeResult.value.json().code, 'PRECONDITION_FAILED', removeResult.value.body)
      await markInvocationRunning(app.db, invocationResult.value.invocationId)
      await completeInvocation(app.db, invocationResult.value.invocationId, { status: 'failed' })
      const removed = await post('remove', { version, password: devUser.password }, devHeaders)
      assert.equal(removed.json().success, true, removed.body)
    } else {
      assert.equal(removeResult.value.json().success, true, removeResult.value.body)
      assert.equal(invocationResult.reason?.code, 'NOT_FOUND')
    }
    const deletedVersion = version + 1
    assert.equal((await readTarget()).json().code, 'NOT_FOUND')
    assert.equal((await readTarget('/requirements')).json().code, 'NOT_FOUND')
    assert.equal(
      (await app.inject({ url: `/api/v1/requirements/${childId}`, headers: viewHeaders })).json().code,
      'NOT_FOUND',
    )
    assert.equal(
      (await app.inject({ url: `/api/v1/projects/${siblingId}`, headers: viewHeaders })).json().success,
      true,
    )
    const hidden = await app.inject({
      url: `/api/v1/teams/${teamId}/projects?search=${encodeURIComponent('内部平台')}`,
      headers: viewHeaders,
    })
    assert.ok(!hidden.json().data.items.some((item: { id: string }) => item.id === targetId))
    const recycle = (await readRecycle()).json().data.items
    assert.deepEqual(
      recycle.map((item: { id: string }) => item.id),
      [targetId],
    )
    assert.equal(recycle[0].cleanupStatus, 'none')
    assert.equal((await post('restore', { version: deletedVersion }, devHeaders)).json().code, 'FORBIDDEN')
    assert.equal(
      (await post('cleanup-files', { version: deletedVersion, password: '错误密码' })).json().code,
      'PASSWORD_INVALID',
    )
    assert.deepEqual(await pipelineStorage.readArtifact(artifact.storageKey), body)

    const requested = await post('cleanup-files', { version: deletedVersion, password })
    assert.equal(requested.json().data.cleanupStatus, 'queued')
    const repeated = await post('cleanup-files', { version: deletedVersion, password })
    assert.equal(repeated.json().data.id, requested.json().data.id)
    assert.equal((await post('restore', { version: deletedVersion })).json().code, 'PRECONDITION_FAILED')
    const jobId: string = requested.json().data.id
    await app.db
      .update(projectFileCleanup)
      .set({ status: 'running', lease_token: randomUUID(), lease_until: new Date(0) })
      .where(eq(projectFileCleanup.id, jobId))
    const worker = { db: app.db, storage, pipelineStorage, log: () => undefined }
    await runProjectFileCleanup({
      ...worker,
      pipelineStorage: {
        removeArtifact: async () => {
          throw new Error('模拟产物删除失败')
        },
      },
    })
    assert.equal((await readRecycle()).json().data.items[0].cleanupStatus, 'failed')
    const filePath = join(config.ATTACHMENT_STORAGE_DIR, 'attachments', teamId, targetId, attachmentId)
    await assert.rejects(readFile(filePath), { code: 'ENOENT' })
    assert.equal((await post('cleanup-files', { version: deletedVersion, password })).json().data.id, jobId)
    await runProjectFileCleanup(worker)
    assert.equal((await readRecycle()).json().data.items[0].cleanupStatus, 'succeeded')
    await assert.rejects(pipelineStorage.readArtifact(artifact.storageKey))
    assert.equal(await pipelineStorage.readLogChunk(log.storageKey), '保留运行日志')
    assert.deepEqual(
      await readFile(join(config.ATTACHMENT_STORAGE_DIR, 'attachments', teamId, siblingId, siblingAttachmentId)),
      body,
    )

    assert.equal((await post('restore', { version: deletedVersion })).json().success, true)
    assert.equal((await readTarget()).json().data.name, '内部平台')
    assert.equal((await readTarget()).json().data.status, 'paused')
    const restoredChild = await app.inject({ url: `/api/v1/requirements/${childId}`, headers: viewHeaders })
    assert.equal(restoredChild.json().data.attachments[0].contentAvailable, false)
    assert.equal(restoredChild.json().data.attachments[0].id, attachmentId)
    const download = await app.inject({ url: `/api/v1/attachments/${attachmentId}/download`, headers: viewHeaders })
    assert.equal(download.json().code, 'ATTACHMENT_NOT_FOUND')
    const [artifactRow] = await app.db
      .select({ status: pipelineArtifact.status })
      .from(pipelineArtifact)
      .where(eq(pipelineArtifact.id, artifactId))
    assert.equal(artifactRow?.status, 'missing')

    // 同一账号在两种密码操作间切换也不能绕过配额。
    let result
    for (let index = 0; index < 10; index += 1) {
      result = await post(index % 2 ? 'remove' : 'cleanup-files', {
        version: deletedVersion + 1,
        password: '错误密码',
      })
    }
    assert.equal(result?.json().code, 'RATE_LIMITED')
  })
})
