import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
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
import { runAgentDaemon } from '../../apps/pipeline-agent/dist/daemon.js'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const requireFromServer = createRequire(join(root, 'apps/server/package.json'))
const { Client } = requireFromServer('pg')

/** 真实 Docker 构建工作流：使用镜像内已有的 node 与 sh，不访问外网。 */
const BUILD_WORKFLOW = `name: docker-e2e-build
on:
  workflow_dispatch:
    inputs:
      target:
        type: string
        default: web
jobs:
  build:
    runs-on: linux
    timeout-minutes: 5
    steps:
      - uses: builtin:checkout
      - name: Prepare
        run: mkdir -p dist && printf 'docker-e2e-ok' > dist/out.txt
      - name: Log
        run: echo hello-from-docker
      - name: Upload
        uses: builtin:upload-artifact
        with:
          name: docker-dist
          path: dist
`

/** 长任务工作流：用于取消与中断验证。 */
const LONG_WORKFLOW = `name: docker-e2e-long
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    timeout-minutes: 5
    steps:
      - uses: builtin:checkout
      - name: Sleep
        run: node -e "setTimeout(() => process.exit(0), 60000)"
`

const IMAGE = 'node:24-bookworm-slim'

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

/** 从 Better Auth 登录响应的 Set-Cookie 提取 Cookie 头。 */
function cookieHeaderFrom(header) {
  const values = Array.isArray(header) ? header : header ? [header] : []
  return values
    .flatMap((value) => value.split(/,(?=[^;]+=)/))
    .map((value) => value.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')
}

/** 等待条件成立；超时抛出带诊断信息的错误。 */
async function waitFor(condition, timeoutMs, label, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** 执行本机命令并返回 stdout；失败时带命令输出抛出。 */
async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    })
    return result.stdout.trim()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${command} ${args.join(' ')} 失败：${detail}`)
  }
}

/** 在临时目录创建包含工作流的真实 bare 仓库，返回远端地址与提交 SHA。 */
async function createBareRepository() {
  const base = await mkdtemp(join(tmpdir(), 'pipeline-docker-e2e-'))
  const bareDir = join(base, 'repository.git')
  const workDir = join(base, 'work')
  await run('git', ['init', '-q', '--bare', bareDir])
  await run('git', ['-C', bareDir, 'config', 'uploadpack.allowAnySHA1InWant', 'true'])
  await run('git', ['-C', bareDir, 'config', 'uploadpack.allowReachableSHA1InWant', 'true'])
  await mkdir(join(workDir, '.devops/workflows'), { recursive: true })
  await writeFile(join(workDir, '.devops/workflows/ci.yml'), BUILD_WORKFLOW)
  await writeFile(join(workDir, '.devops/workflows/long.yml'), LONG_WORKFLOW)
  await run('git', ['-C', workDir, 'init', '-q'])
  await run('git', ['-C', workDir, 'config', 'user.email', 'e2e@example.test'])
  await run('git', ['-C', workDir, 'config', 'user.name', 'e2e'])
  await run('git', ['-C', workDir, 'add', '.'])
  await run('git', ['-C', workDir, 'commit', '-q', '-m', 'e2e workflow'])
  const sha = await run('git', ['-C', workDir, 'rev-parse', 'HEAD'])
  await run('git', ['-C', workDir, 'push', '-q', bareDir, 'HEAD:refs/heads/main'])
  return { base, bareDir, workDir, sha, remoteUrl: `file://${bareDir}` }
}

/** 检查 Docker 与镜像可用；不可用时返回原因。 */
async function dockerUnavailableReason() {
  try {
    await run('docker', ['version', '--format', '{{.Server.Version}}'])
  } catch {
    return 'Docker 不可用'
  }
  try {
    await run('docker', ['image', 'inspect', IMAGE])
  } catch {
    return `本地缺少镜像 ${IMAGE}（未拉取，避免外网依赖）`
  }
  return null
}

test('V0.4a e2e（真实 Docker）：触发→调度→真实 Agent 执行→日志/产物下载→取消→中断', { timeout: 420_000 }, async (t) => {
  const skipReason = await dockerUnavailableReason()
  if (skipReason) {
    t.skip(`未验证真实 Docker：${skipReason}`)
    return
  }
  const env = { ...(await readEnvFile('apps/server/.env.database')), ...(await readEnvFile('apps/server/.env')) }
  const runtimeValue = process.env.DATABASE_URL ?? env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL ?? env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD ?? env.POSTGRES_PASSWORD
  if (!runtimeValue || !migrationValue || !adminPassword) {
    t.skip('未提供本机数据库环境，跳过真实 Docker e2e')
    return
  }
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  if (runtimeUrl.hostname !== '127.0.0.1' || migrationUrl.host !== runtimeUrl.host) {
    t.skip('仅在本机 Compose 数据库执行真实 Docker e2e')
    return
  }

  const repository = await createBareRepository()
  const databaseName = `dev_ops_pipeline_docker_${randomBytes(8).toString('hex')}`
  const agentWorkDir = await mkdtemp(join(tmpdir(), 'pipeline-e2e-agent-'))
  const storageDir = await mkdtemp(join(tmpdir(), 'pipeline-e2e-storage-'))
  const cleanup = []
  const knownRunIds = []
  t.after(async () => {
    const errors = []
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, '真实 Docker e2e 清理失败')
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
  cleanup.push(async () => {
    for (const runId of knownRunIds) {
      await run('docker', ['ps', '-aq', '--filter', `label=devops.agent.run-id=${runId}`]).then(
        (output) => (output.length > 0 ? run('docker', ['rm', '-f', ...output.split('\n')]) : undefined),
        () => undefined,
      )
    }
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  })
  cleanup.push(() => rm(agentWorkDir, { recursive: true, force: true }))
  cleanup.push(() => rm(storageDir, { recursive: true, force: true }))
  cleanup.push(() => rm(repository.base, { recursive: true, force: true }))
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)

  const adapter = {
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
      return { objectType: 'commit', remoteId: repository.sha, title: 'e2e', state: 'available', url: null }
    },
    async listTree() {
      return [
        { path: '.devops', type: 'directory', size: null },
        { path: '.devops/workflows', type: 'directory', size: null },
        { path: '.devops/workflows/ci.yml', type: 'file', size: null },
        { path: '.devops/workflows/long.yml', type: 'file', size: null },
      ]
    },
    async getFile(input) {
      const content = await readFile(join(repository.workDir, input.path), 'utf8')
      return { path: input.path, content, truncated: false }
    },
    async listBranches() {
      return ['main']
    },
    async listCommits() {
      return [
        {
          sha: repository.sha,
          title: 'e2e workflow',
          authorName: 'e2e',
          committedAt: '2026-11-10T08:00:00Z',
          url: null,
        },
      ]
    },
    async getCommit() {
      return {
        sha: repository.sha,
        title: 'e2e workflow',
        authorName: 'e2e',
        committedAt: '2026-11-10T08:00:00Z',
        url: null,
        files: [],
        filesTruncated: false,
        filesUnsupported: true,
      }
    },
  }
  const pipelineCredentials = {
    async issueGitCredential(input) {
      return {
        remoteUrl: repository.remoteUrl,
        username: 'x-access-token',
        password: 'e2e-docker-token',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        commitSha: input.commitSha,
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
  const app = createHttpApp(config, {
    gitAdapterResolver: async () => adapter,
    activeConnectionIds: async () => [connectionId],
    pipelineCredentials,
  })
  cleanup.push(() => app.close())
  const address = await app.listen({ port: 0, host: '127.0.0.1' })

  /** 通过真实 HTTP 调用平台接口。 */
  async function api(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers ?? {}) }
    if (options.cookie) headers.cookie = options.cookie
    if (options.bearer) headers.authorization = `Bearer ${options.bearer}`
    let body = options.body
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(body)
    }
    const response = await fetch(`${address}${path}`, { method: options.method ?? 'GET', headers, body })
    return { status: response.status, body: await response.json() }
  }

  /** 断言成功信封并返回 data。 */
  function successData(body, label) {
    assert.equal(body.success, true, `${label} 应成功：${JSON.stringify(body)}`)
    return body.data
  }

  const email = `admin-${randomBytes(4).toString('hex')}@example.test`
  const password = 'e2e-password-123'
  const signup = await app.auth.api.signUpEmail({ body: { email, password, name: '真实 Docker 管理员' } })
  const userId = signup.user.id
  const signIn = await app.auth.api.signInEmail({ body: { email, password }, asResponse: true })
  const cookie = cookieHeaderFrom(signIn.headers.getSetCookie())
  assert.ok(cookie.length > 0, '管理员登录应返回会话 Cookie')

  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `e2e-docker-${randomBytes(3).toString('hex')}`, created_by_user_id: userId })
  await app.db
    .insert(teamMember)
    .values({ id: randomUUID(), team_id: teamId, user_id: userId, role: 'admin', status: 'active' })
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '真实 Docker E2E 项目',
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

  const nodeName = `docker-node-${randomBytes(3).toString('hex')}`
  const createdNode = await api(`/api/v1/teams/${teamId}/pipeline-nodes`, {
    method: 'POST',
    cookie,
    body: { name: nodeName, capabilities: ['linux', 'docker', 'node24'] },
  })
  const nodeData = successData(createdNode.body, '创建节点')

  const daemonStop = new AbortController()
  const daemonLogs = []
  const daemonPromise = runAgentDaemon({
    config: {
      platformUrl: address,
      registrationToken: nodeData.registrationToken,
      nodeName,
      workDir: agentWorkDir,
      labels: ['linux', 'docker', 'node24'],
      pollWaitSeconds: 2,
      controlTimeoutMs: 15_000,
      artifactUploadTimeoutMs: 60_000,
      artifactMaxBytes: 10 * 1024 * 1024,
      logChunkMaxBytes: 65_536,
      container: { cpus: 1, memoryBytes: 1024 * 1024 * 1024, pidsLimit: 256 },
    },
    signal: daemonStop.signal,
    writeLog: (line) => daemonLogs.push(line),
  })
  cleanup.push(async () => {
    daemonStop.abort()
    await daemonPromise.catch(() => undefined)
  })
  const scheduler = createPipelineScheduler({
    db: app.db,
    config: { leaseTtlSeconds: 30, heartbeatTimeoutSeconds: 15 },
    log: () => undefined,
  })

  await waitFor(
    async () => {
      const nodes = await api(`/api/v1/teams/${teamId}/pipeline-nodes`, { cookie })
      const item = nodes.body.data?.items?.find((node) => node.name === nodeName)
      return item?.status === 'online'
    },
    30_000,
    'Agent 注册并上线',
  )

  /** 触发运行并驱动调度；返回运行标识。 */
  async function triggerRun(workflowPath, idempotencyKey) {
    const triggered = await api(`/api/v1/projects/${projectId}/pipeline-runs`, {
      method: 'POST',
      cookie,
      body: { workflowPath, ref: 'main', idempotencyKey },
    })
    const run = successData(triggered.body, '触发运行')
    knownRunIds.push(run.runId)
    assert.equal(run.status, 'queued')
    return run.runId
  }

  /** 轮询运行详情直到状态命中期望集合。 */
  async function waitStatus(runId, expected, timeoutMs, label) {
    let latest
    await waitFor(
      async () => {
        const response = await api(`/api/v1/pipeline-runs/${runId}`, { cookie })
        latest = response.body?.data
        return expected.includes(latest?.status)
      },
      timeoutMs,
      label,
    )
    return latest
  }

  /** 等待容器被 Agent 清理。 */
  async function waitNoContainer(runId, timeoutMs = 30_000) {
    await waitFor(
      async () => {
        const output = await run('docker', ['ps', '-aq', '--filter', `label=devops.agent.run-id=${runId}`])
        return output.length === 0
      },
      timeoutMs,
      `运行 ${runId} 的容器已清理`,
      1_000,
    )
  }

  await t.test('真实执行闭环：bare git 仓库检出 + 真实容器 + 日志上传 + 产物 SHA-256 下载', async () => {
    const runId = await triggerRun('.devops/workflows/ci.yml', `docker-${randomUUID()}`)
    await scheduler.runCycle()
    const finished = await waitStatus(runId, ['succeeded', 'failed', 'interrupted'], 240_000, '真实 Docker 运行完成')
    assert.equal(finished.status, 'succeeded', `真实 Docker 运行应成功：${JSON.stringify(finished)}`)

    const steps = finished.steps
    assert.ok(Array.isArray(steps) && steps.length >= 4)
    for (const step of steps) {
      assert.equal(step.status, 'succeeded', `步骤 ${step.name} 应成功：${JSON.stringify(step)}`)
    }

    // 不传 afterSeq 时应从首片 seq=0 开始返回（D5 修复后的契约口径）。
    const logs = await api(`/api/v1/pipeline-runs/${runId}/logs?stepIndex=2`, { cookie })
    const logData = logs.body.data
    assert.ok(Array.isArray(logData.items) && logData.items.length > 0, `平台日志应可读：${JSON.stringify(logs.body)}`)
    assert.equal(logData.items[0].seq, 0, `日志首片应为 seq=0：${JSON.stringify(logData.items)}`)
    const logText = JSON.stringify(logData)
    assert.equal(logText.includes('hello-from-docker'), true, `平台日志应包含容器输出：${logText}`)

    const artifactList = await api(`/api/v1/pipeline-runs/${runId}/artifacts`, { cookie })
    const artifacts = successData(artifactList.body, '产物列表')
    assert.equal(artifacts.items.length, 1, '应上传一个产物')
    const artifact = artifacts.items[0]
    assert.equal(artifact.name, 'docker-dist')
    const download = await fetch(`${address}/api/v1/pipeline-artifacts/${artifact.artifactId}/download`, {
      headers: { cookie },
    })
    assert.equal(download.status, 200)
    const bytes = Buffer.from(await download.arrayBuffer())
    const sha = createHash('sha256').update(bytes).digest('hex')
    assert.equal(sha, artifact.sha256, '下载内容 SHA-256 应与产物记录一致')
    assert.equal(download.headers.get('x-content-sha256'), sha)
    await waitNoContainer(runId)
  })

  await t.test('取消：平台取消下发心跳/续约，真实 Agent 停止容器并上报 cancelled', async () => {
    const runId = await triggerRun('.devops/workflows/long.yml', `docker-cancel-${randomUUID()}`)
    await scheduler.runCycle()
    await waitStatus(runId, ['running'], 120_000, '长任务进入 running')
    const cancelled = await api(`/api/v1/pipeline-runs/${runId}/cancel`, {
      method: 'POST',
      cookie,
      body: { reason: '真实 Docker 取消验证' },
    })
    assert.equal(cancelled.body.success, true, JSON.stringify(cancelled.body))
    const finished = await waitStatus(runId, ['cancelled', 'interrupted'], 120_000, '取消后运行收口')
    assert.equal(finished.status, 'cancelled', `取消后状态应为 cancelled：${JSON.stringify(finished)}`)
    await waitNoContainer(runId)
  })

  await t.test('中断：Agent 收到退出信号后按 interrupted 收口中断运行并清理容器', async () => {
    const runId = await triggerRun('.devops/workflows/long.yml', `docker-interrupt-${randomUUID()}`)
    await scheduler.runCycle()
    await waitStatus(runId, ['running'], 120_000, '长任务进入 running')
    daemonStop.abort()
    await daemonPromise
    const finished = await waitStatus(runId, ['interrupted', 'cancelled', 'failed'], 60_000, '中断后运行收口')
    assert.equal(finished.status, 'interrupted', `Agent 退出后运行应为 interrupted：${JSON.stringify(finished)}`)
    await waitNoContainer(runId)
    assert.equal(daemonLogs.length > 0, true, 'Agent 应有可观测日志输出')
  })
})
