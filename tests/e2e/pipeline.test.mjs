import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createHttpApp } from '../../apps/server/dist/bootstrap/create-http-app.js'
import { loadConfig } from '../../apps/server/dist/platform/config/env.js'
import { migrateDatabase } from '../../apps/server/dist/platform/database/migrate.js'
import { createPipelineScheduler } from '../../apps/server/dist/modules/pipeline/pipeline.scheduler.js'
import { team, teamMember } from '../../apps/server/dist/modules/identity/identity.tables.js'
import { project } from '../../apps/server/dist/modules/projects/projects.tables.js'
import { gitConnection } from '../../apps/server/dist/modules/integrations/integrations.tables.js'
import { gitRepository } from '../../apps/server/dist/modules/code/code.tables.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const requireFromServer = createRequire(join(root, 'apps/server/package.json'))
const { Client } = requireFromServer('pg')

const WORKFLOW = `name: e2e-build
on:
  workflow_dispatch:
    inputs:
      target:
        type: string
        default: web
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
      - name: Build
        run: echo build
      - name: Upload
        uses: builtin:upload-artifact
        with:
          name: e2e-dist
          path: dist
`

const COMMIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

/** 从 apps/server/.env 系列文件读取本地数据库配置。 */
async function readEnvFile(relativePath) {
  try {
    const text = await readFile(join(root, relativePath), 'utf8')
    const values = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index <= 0) continue
      values[trimmed.slice(0, index)] = trimmed.slice(index + 1)
    }
    return values
  } catch {
    return {}
  }
}

/** 从 Better Auth 登录响应的 Set-Cookie 提取可用 Cookie 头。 */
function cookieHeaderFrom(header) {
  const values = Array.isArray(header) ? header : header ? [header] : []
  return values
    .flatMap((value) => value.split(/,(?=[^;]+=)/))
    .map((value) => value.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')
}

/** 断言成功信封并返回 data。 */
function successData(body, label) {
  assert.equal(body.success, true, `${label} 应成功：${JSON.stringify(body)}`)
  return body.data
}

test(
  'V0.4a e2e：触发→调度→Agent 执行→日志→产物下载→取消→中断（真实 PG/HTTP，Agent 协议模拟）',
  { timeout: 240_000 },
  async (t) => {
    const env = { ...(await readEnvFile('apps/server/.env.database')), ...(await readEnvFile('apps/server/.env')) }
    const runtimeValue = process.env.DATABASE_URL ?? env.DATABASE_URL
    const migrationValue = process.env.MIGRATION_DATABASE_URL ?? env.MIGRATION_DATABASE_URL
    const adminPassword = process.env.POSTGRES_PASSWORD ?? env.POSTGRES_PASSWORD
    if (!runtimeValue || !migrationValue || !adminPassword) {
      t.skip('未提供本机数据库环境，跳过流水线 e2e')
      return
    }
    const runtimeUrl = new URL(runtimeValue)
    const migrationUrl = new URL(migrationValue)
    if (runtimeUrl.hostname !== '127.0.0.1' || migrationUrl.host !== runtimeUrl.host) {
      t.skip('仅在本机 Compose 数据库执行流水线 e2e')
      return
    }

    const databaseName = `dev_ops_pipeline_e2e_${randomBytes(8).toString('hex')}`
    const storageDir = await mkdtemp(join(tmpdir(), 'pipeline-e2e-storage-'))
    const cleanup = []
    t.after(async () => {
      const errors = []
      for (const dispose of cleanup.reverse()) {
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, '流水线 e2e 清理失败')
    })
    const admin = new Client({
      host: runtimeUrl.hostname,
      port: Number(runtimeUrl.port || '5432'),
      user: 'postgres',
      password: adminPassword,
      database: 'postgres',
      connectionTimeoutMillis: 5_000,
    })
    await admin.connect()
    cleanup.push(() => admin.end())
    await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
    cleanup.push(() => admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`))
    await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
    await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
    runtimeUrl.pathname = `/${databaseName}`
    migrationUrl.pathname = `/${databaseName}`
    await migrateDatabase(migrationUrl.href)
    cleanup.push(() => rm(storageDir, { recursive: true, force: true }))

    const fakeGit = {
      files: new Map([['.devops/workflows/ci.yml', WORKFLOW]]),
      adapter: {
        async checkConnection() {
          return { identity: 'e2e' }
        },
        async listRepositories() {
          return [
            {
              remoteId: 'e2e/app',
              namespace: 'e2e',
              name: 'app',
              webUrl: 'https://e2e.example/app',
              defaultBranch: 'main',
            },
          ]
        },
        async getObject() {
          return { objectType: 'commit', remoteId: COMMIT_SHA, title: 'e2e', state: 'available', url: null }
        },
        async listTree() {
          const entries = []
          for (const [path, content] of fakeGit.files) {
            entries.push({ path, type: 'file', size: Buffer.byteLength(content, 'utf8') })
          }
          entries.push({ path: '.devops', type: 'directory', size: null })
          entries.push({ path: '.devops/workflows', type: 'directory', size: null })
          return entries
        },
        async getFile(input) {
          const content = fakeGit.files.get(input.path)
          if (content === undefined) {
            const error = new Error('文件不存在')
            error.code = 'not_found'
            throw Object.assign(new Error('远端文件不存在'), { name: 'GitAdapterError', code: 'not_found' })
          }
          return { path: input.path, content, truncated: false }
        },
        async listBranches() {
          return ['main']
        },
        async listCommits() {
          return [
            {
              sha: COMMIT_SHA,
              title: 'e2e commit',
              authorName: 'e2e',
              committedAt: '2026-11-10T08:00:00Z',
              url: null,
            },
          ]
        },
        async getCommit() {
          return {
            sha: COMMIT_SHA,
            title: 'e2e commit',
            authorName: 'e2e',
            committedAt: '2026-11-10T08:00:00Z',
            url: null,
            files: [],
            filesTruncated: false,
            filesUnsupported: true,
          }
        },
      },
    }
    const pipelineCredentials = {
      async issueGitCredential(repository) {
        return {
          remoteUrl: `${repository.webUrl}.git`,
          username: 'x-access-token',
          password: 'e2e-test-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          commitSha: repository.commitSha,
        }
      },
      async resolveSecrets() {
        return {}
      },
    }

    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: runtimeUrl.href,
      AUTH_SECRET: env.AUTH_SECRET ?? 'e2e-auth-secret-at-least-32-characters',
      APP_ORIGIN: 'http://127.0.0.1:5173',
      AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
      DB_STATEMENT_TIMEOUT_MS: '2000',
      DB_LOCK_TIMEOUT_MS: '1000',
      PIPELINE_STORAGE_DIR: storageDir,
      PIPELINE_LEASE_TTL_SECONDS: '30',
      PIPELINE_HEARTBEAT_TIMEOUT_SECONDS: '15',
    })
    const connectionId = randomUUID()
    const database = new Client({ connectionString: runtimeUrl.href, connectionTimeoutMillis: 5_000 })
    await database.connect()
    cleanup.push(() => database.end())
    const app = createHttpApp(config, {
      gitAdapterResolver: async () => fakeGit.adapter,
      activeConnectionIds: async () => [connectionId],
      pipelineCredentials,
    })
    cleanup.push(() => app.close())
    const address = await app.listen({ port: 0, host: '127.0.0.1' })

    /** 通过真实 HTTP 调用平台接口，返回 JSON 信封。 */
    async function api(path, options = {}) {
      const headers = { accept: 'application/json', ...(options.headers ?? {}) }
      if (options.cookie) headers.cookie = options.cookie
      if (options.bearer) headers.authorization = `Bearer ${options.bearer}`
      let body = options.body
      if (body !== undefined && !(body instanceof Buffer)) {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(body)
      }
      const response = await fetch(`${address}${path}`, { method: options.method ?? 'GET', headers, body })
      const text = await response.text()
      return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null }
    }

    const email = `admin-${randomBytes(4).toString('hex')}@example.test`
    const password = 'e2e-password-123'
    await app.auth.api.signUpEmail({ body: { email, password, name: '流水线管理员' } })
    const signIn = await app.auth.api.signInEmail({ body: { email, password }, asResponse: true })
    const cookie = cookieHeaderFrom(signIn.headers.getSetCookie())
    assert.ok(cookie.length > 0, '管理员登录应返回会话 Cookie')
    const adminUser = signIn.headers ? await app.auth.api.getSession({ headers: new Headers({ cookie }) }) : null
    const userId = adminUser?.user?.id
    assert.ok(userId, '应能读取登录用户标识')

    const teamId = randomUUID()
    await app.db
      .insert(team)
      .values({ id: teamId, name: `e2e-team-${randomBytes(3).toString('hex')}`, created_by_user_id: userId })
    await app.db
      .insert(teamMember)
      .values({ id: randomUUID(), team_id: teamId, user_id: userId, role: 'admin', status: 'active' })
    const projectId = randomUUID()
    await app.db.insert(project).values({
      id: projectId,
      team_id: teamId,
      name: '流水线 E2E 项目',
      owner_user_id: userId,
      created_by_user_id: userId,
    })
    await app.db.insert(gitConnection).values({
      id: connectionId,
      team_id: teamId,
      provider_key: 'github',
      instance_url: 'https://github.com',
      name: 'GitHub',
      status: 'active',
      auth_kind: 'github_cli',
      created_by_user_id: userId,
    })
    const repositoryId = randomUUID()
    await app.db.insert(gitRepository).values({
      id: repositoryId,
      team_id: teamId,
      connection_id: connectionId,
      provider_key: 'github',
      remote_repository_id: 'e2e/app',
      namespace: 'e2e',
      name: 'app',
      web_url: 'https://e2e.example/app',
      default_branch: 'main',
    })
    const linked = await api(`/api/v1/projects/${projectId}/repositories`, {
      method: 'POST',
      cookie,
      body: { repositoryId },
    })
    assert.equal(linked.body.success, true, JSON.stringify(linked.body))

    await t.test('T038/quickstart 步骤 1–2：工作流发现与解析状态', async () => {
      const workflows = await api(`/api/v1/projects/${projectId}/pipeline-workflows`, { cookie })
      const data = successData(workflows.body, '工作流列表')
      assert.equal(data.ref, 'main')
      assert.equal(data.commitSha, COMMIT_SHA)
      assert.equal(data.items.length, 1)
      assert.equal(data.items[0].path, '.devops/workflows/ci.yml')
      assert.equal(data.items[0].valid, true)
      assert.equal(data.items[0].name, 'e2e-build')
    })

    await t.test('T038/quickstart 步骤 5：触发→调度→Agent 领取租约', async () => {
      const triggered = await api(`/api/v1/projects/${projectId}/pipeline-runs`, {
        method: 'POST',
        cookie,
        body: {
          workflowPath: '.devops/workflows/ci.yml',
          ref: 'main',
          inputs: { target: 'web' },
          idempotencyKey: 'e2e-001',
        },
      })
      const run = successData(triggered.body, '触发运行')
      assert.equal(run.status, 'queued')
      assert.equal(run.commitSha, COMMIT_SHA)
      const runId = run.runId

      const scheduler = createPipelineScheduler({
        db: app.db,
        config: { leaseTtlSeconds: 30, heartbeatTimeoutSeconds: 15 },
        log: () => undefined,
      })
      const nodeName = `e2e-node-${randomBytes(3).toString('hex')}`
      const createdNode = await api(`/api/v1/teams/${teamId}/pipeline-nodes`, {
        method: 'POST',
        cookie,
        body: { name: nodeName, capabilities: ['linux', 'docker', 'node24'] },
      })
      const nodeData = successData(createdNode.body, '创建节点')
      const registered = await api('/api/v1/agent/register', {
        method: 'POST',
        body: {
          registrationToken: nodeData.registrationToken,
          name: nodeName,
          os: 'linux',
          arch: 'x64',
          capabilities: ['linux', 'docker', 'node24'],
          agentVersion: '0.1.0',
        },
      })
      const agentData = successData(registered.body, 'Agent 注册')
      const agentToken = agentData.agentToken
      await scheduler.runCycle()
      const assigned = await api(`/api/v1/pipeline-runs/${runId}`, { cookie })
      assert.equal(successData(assigned.body, '运行详情').status, 'assigned')

      const leaseResponse = await api('/api/v1/agent/lease', {
        method: 'POST',
        bearer: agentToken,
        body: { waitSeconds: 1 },
      })
      const lease = successData(leaseResponse.body, '领取租约')
      assert.ok(lease, 'Agent 应领取到租约')
      assert.equal(lease.run.runId, runId)
      const sha = createHash('sha256').update(Buffer.from('e2e-artifact')).digest('hex')

      const stepStatus = await api(`/api/v1/agent/lease/${lease.leaseId}/steps/0/status`, {
        method: 'POST',
        bearer: agentToken,
        headers: { 'x-lease-token': lease.leaseToken },
        body: { status: 'running', exitCode: null, errorCode: null, errorMessage: null },
      })
      assert.equal(successData(stepStatus.body, '步骤状态').status, 'running')

      const logs = await api(`/api/v1/agent/lease/${lease.leaseId}/logs`, {
        method: 'POST',
        bearer: agentToken,
        headers: { 'x-lease-token': lease.leaseToken },
        body: { chunks: [{ stepIndex: 1, seq: 0, content: 'e2e build output\n' }] },
      })
      assert.equal(successData(logs.body, '日志上传').acceptedThrough['1'], 0)

      const artifactUpload = await fetch(`${address}/api/v1/agent/lease/${lease.leaseId}/artifacts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${agentToken}`,
          'x-lease-token': lease.leaseToken,
          'x-step-index': '2',
          'x-artifact-name': 'e2e-dist',
          'x-content-sha256': sha,
          'content-type': 'application/octet-stream',
        },
        body: Buffer.from('e2e-artifact'),
      })
      const artifactBody = await artifactUpload.json()
      const artifact = successData(artifactBody, '产物上传')
      assert.equal(artifact.sha256, sha)

      const completed = await api(`/api/v1/agent/lease/${lease.leaseId}/complete`, {
        method: 'POST',
        bearer: agentToken,
        headers: { 'x-lease-token': lease.leaseToken },
        body: { status: 'succeeded', errorCode: null, errorMessage: null },
      })
      assert.equal(successData(completed.body, '完成上报').status, 'succeeded')

      const finished = await api(`/api/v1/pipeline-runs/${runId}`, { cookie })
      const finishedData = successData(finished.body, '运行详情')
      assert.equal(finishedData.status, 'succeeded')
      // 不传 afterSeq 时从首片 seq=0 开始返回，验证首片可读。
      const readableLogs = await api(`/api/v1/pipeline-runs/${runId}/logs?stepIndex=1`, { cookie })
      const logData = successData(readableLogs.body, '日志读取')
      assert.equal(logData.items.length, 1)
      assert.equal(logData.items[0].seq, 0)
      assert.equal(logData.items[0].content, 'e2e build output\n')

      const artifactList = await api(`/api/v1/pipeline-runs/${runId}/artifacts`, { cookie })
      const artifacts = successData(artifactList.body, '产物列表')
      assert.equal(artifacts.items.length, 1)
      const download = await fetch(`${address}/api/v1/pipeline-artifacts/${artifacts.items[0].artifactId}/download`, {
        headers: { cookie },
      })
      assert.equal(download.status, 200)
      assert.equal(download.headers.get('x-content-sha256'), sha)
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from('e2e-artifact'))

      const duplicate = await api(`/api/v1/projects/${projectId}/pipeline-runs`, {
        method: 'POST',
        cookie,
        body: {
          workflowPath: '.devops/workflows/ci.yml',
          ref: 'main',
          inputs: { target: 'web' },
          idempotencyKey: 'e2e-001',
        },
      })
      assert.equal(successData(duplicate.body, '幂等触发').runId, runId)
    })

    await t.test('T084/quickstart 步骤 6–7：取消与租约过期中断', async () => {
      const triggered = await api(`/api/v1/projects/${projectId}/pipeline-runs`, {
        method: 'POST',
        cookie,
        body: {
          workflowPath: '.devops/workflows/ci.yml',
          ref: 'main',
          inputs: { target: 'web' },
          idempotencyKey: 'e2e-cancel-001',
        },
      })
      const runId = successData(triggered.body, '触发取消验证运行').runId
      const cancelled = await api(`/api/v1/pipeline-runs/${runId}/cancel`, {
        method: 'POST',
        cookie,
        body: { reason: 'e2e 取消' },
      })
      assert.equal(successData(cancelled.body, '取消运行').status, 'cancelled')

      const interruptRun = await api(`/api/v1/projects/${projectId}/pipeline-runs`, {
        method: 'POST',
        cookie,
        body: {
          workflowPath: '.devops/workflows/ci.yml',
          ref: 'main',
          inputs: { target: 'web' },
          idempotencyKey: 'e2e-interrupt-001',
        },
      })
      const interruptRunId = successData(interruptRun.body, '触发中断验证运行').runId
      const scheduler = createPipelineScheduler({
        db: app.db,
        config: { leaseTtlSeconds: 30, heartbeatTimeoutSeconds: 15 },
        log: () => undefined,
      })
      await scheduler.runCycle()
      const assigned = await api(`/api/v1/pipeline-runs/${interruptRunId}`, { cookie })
      assert.equal(successData(assigned.body, '中断验证运行详情').status, 'assigned')
      const nodeList = await api(`/api/v1/teams/${teamId}/pipeline-nodes`, { cookie })
      const nodes = successData(nodeList.body, '节点列表')
      const node = nodes.items.find((item) => item.name === nodes.items[0]?.name)
      assert.ok(node, '应存在已注册节点')
      const leaseRows = await database.query(
        'select count(*)::int as count from app.pipeline_lease where run_id = $1',
        [interruptRunId],
      )
      assert.equal(leaseRows.rows[0].count, 0, '未领取的 assigned 运行没有租约')
      // 模拟节点心跳超时：把节点心跳置为过期后由 Worker 收口为 interrupted。
      await database.query(
        "update app.pipeline_node set last_heartbeat_at = now() - interval '2 hours' where team_id = $1",
        [teamId],
      )
      await scheduler.runCycle()
      const interrupted = await api(`/api/v1/pipeline-runs/${interruptRunId}`, { cookie })
      assert.equal(successData(interrupted.body, '中断运行详情').status, 'interrupted')
      assert.equal(successData(interrupted.body, '中断运行详情').errorCode, 'NODE_OFFLINE')
    })
  },
)
