import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestContext } from 'node:test'
import { Client } from 'pg'
import type { FastifyInstance } from 'fastify'
import {
  GitAdapterError,
  type GitAdapter,
  type GitCommitDetail,
  type GitCommitSummary,
  type GitFileContent,
  type GitFileInput,
  type GitTreeEntry,
  type GitTreeInput,
} from '../../src/adapters/git/git.types.ts'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.ts'
import { gitRepository } from '../../src/modules/code/code.tables.ts'
import { pipelineNode, pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import { eq } from 'drizzle-orm'
import { createPipelineScheduler } from '../../src/modules/pipeline/pipeline.scheduler.ts'
import type { PipelineCredentialProvider } from '../../src/modules/pipeline/pipeline.credentials.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

/** 统一响应信封的测试视图；只保留断言需要的字段。 */
export interface TestEnvelope {
  success: boolean
  code: string
  message: string
  requestId: string
  data?: unknown
}

/** 一次注入请求的结果；保留原始响应体便于输出诊断信息。 */
export interface TestResponse {
  statusCode: number
  envelope: TestEnvelope
  body: string
}

/** 测试账号：用户标识与可复用 Cookie。 */
export interface TestActor {
  userId: string
  cookie: string
}

/** 流水线集成测试的隔离环境。 */
export interface PipelineTestContext {
  app: FastifyInstance
  runtimeUrl: string
  migrationUrl: string
  storageDir: string
  git: MutableFakeGit
  credentials: {
    setSecret(name: string, value: string): void
    secretNames(): string[]
    issueCount(): number
  }
  teamId: string
  projectId: string
  repositoryId: string
  connectionId: string
  admin: TestActor
  developer: TestActor
  viewer: TestActor
  stranger: TestActor
  otherTeam: { teamId: string; projectId: string; repositoryId: string; admin: TestActor }
}

/** 固定提交；契约要求触发后运行固定 commitSha。 */
export const TEST_COMMIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

/** 合法工作流内容；字段来自 contracts/workflow-yaml.md 声明子集。 */
export const VALID_WORKFLOW = `name: web-build
on:
  workflow_dispatch:
    inputs:
      target:
        type: choice
        options: [web, api]
        default: web
env:
  NODE_ENV: production
jobs:
  build:
    runs-on: linux
    timeout-minutes: 20
    steps:
      - uses: builtin:checkout
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm --dir apps/web build
        env:
          TARGET: \${{ inputs.target }}
      - name: Upload
        uses: builtin:upload-artifact
        with:
          name: web-dist
          path: apps/web/dist
`

/** 非法 YAML：缩进错误，用于验证解析错误不会创建运行。 */
export const INVALID_YAML_WORKFLOW = `name: broken
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
      - name: 未闭合
        run: [unclosed
`

/** 不支持的语法：actions 动作，用于验证 WORKFLOW_UNSUPPORTED。 */
export const UNSUPPORTED_WORKFLOW = `name: unsupported
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: actions/checkout@v4
`

const WORKFLOW_DIRECTORY = '.devops/workflows'

/** 可变 Git 替身：测试可以替换文件、提交与失败状态，不访问网络。 */
export interface MutableFakeGit {
  adapter: GitAdapter
  setFile(path: string, content: string): void
  removeFile(path: string): void
  failWith(error: GitAdapterError | null): void
  lastTreeRef(): string | undefined
  lastFileRef(): string | undefined
}

/** 创建确定性 Git 替身；仓库为 acme/app，默认分支 main。 */
export function createMutableFakeGit(): MutableFakeGit {
  const files = new Map<string, string>([
    [`${WORKFLOW_DIRECTORY}/ci.yml`, VALID_WORKFLOW],
    [`${WORKFLOW_DIRECTORY}/broken.yaml`, INVALID_YAML_WORKFLOW],
    [`${WORKFLOW_DIRECTORY}/unsupported.yml`, UNSUPPORTED_WORKFLOW],
    ['README.md', '# acme/app\n'],
  ])
  let failure: GitAdapterError | null = null
  let lastTreeRef: string | undefined
  let lastFileRef: string | undefined
  const commit: GitCommitSummary = {
    sha: TEST_COMMIT_SHA,
    title: 'feat: 初始提交',
    authorName: '测试用户',
    committedAt: '2026-11-10T08:00:00Z',
    url: `https://example.test/acme/app/commit/${TEST_COMMIT_SHA}`,
  }
  const commitDetail: GitCommitDetail = { ...commit, files: [], filesTruncated: false, filesUnsupported: true }
  const adapter: GitAdapter = {
    async checkConnection() {
      if (failure) throw failure
      return { identity: 'fake' }
    },
    async listRepositories() {
      if (failure) throw failure
      return [
        {
          remoteId: 'acme/app',
          namespace: 'acme',
          name: 'app',
          webUrl: 'https://example.test/acme/app',
          defaultBranch: 'main',
        },
      ]
    },
    async getObject() {
      if (failure) throw failure
      return {
        objectType: 'commit',
        remoteId: TEST_COMMIT_SHA,
        title: commit.title,
        state: 'available',
        url: commit.url,
      }
    },
    async listTree(input: GitTreeInput): Promise<GitTreeEntry[]> {
      lastTreeRef = input.ref
      if (failure) throw failure
      const entries: GitTreeEntry[] = []
      const directories = new Set<string>()
      for (const path of files.keys()) {
        const segments = path.split('/')
        for (let index = 1; index < segments.length; index += 1) {
          directories.add(segments.slice(0, index).join('/'))
        }
      }
      for (const path of files.keys()) {
        entries.push({ path, type: 'file', size: Buffer.byteLength(files.get(path) ?? '', 'utf8') })
      }
      for (const path of directories) entries.push({ path, type: 'directory', size: null })
      return entries
    },
    async getFile(input: GitFileInput): Promise<GitFileContent> {
      lastFileRef = input.ref
      if (failure) throw failure
      const content = files.get(input.path)
      if (content === undefined) throw new GitAdapterError('not_found', '远端文件不存在')
      return { path: input.path, content, truncated: false }
    },
    async listBranches() {
      if (failure) throw failure
      return ['main']
    },
    async listCommits() {
      if (failure) throw failure
      return [commit]
    },
    async getCommit(): Promise<GitCommitDetail> {
      if (failure) throw failure
      return commitDetail
    },
  }
  return {
    adapter,
    setFile(path, content) {
      files.set(path, content)
    },
    removeFile(path) {
      files.delete(path)
    },
    failWith(error) {
      failure = error
    },
    lastTreeRef() {
      return lastTreeRef
    },
    lastFileRef() {
      return lastFileRef
    },
  }
}

/** 解析统一信封；响应体不是 JSON 对象时抛出带原文的错误。 */
export function parseEnvelope(response: { json(): unknown; body: string }): TestEnvelope {
  const parsed: unknown = response.json()
  assert.ok(isRecord(parsed), `响应不是 JSON 对象：${response.body}`)
  return {
    success: parsed.success === true,
    code: typeof parsed.code === 'string' ? parsed.code : '',
    message: typeof parsed.message === 'string' ? parsed.message : '',
    requestId: typeof parsed.requestId === 'string' ? parsed.requestId : '',
    ...(parsed.data === undefined ? {} : { data: parsed.data }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把未知值收窄为记录；失败时输出可读原因。 */
export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} 期望对象，实际为 ${typeof value}`)
  return value
}

/** 读取记录中的字符串字段；缺失或类型不符时抛出。 */
export function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`字段 ${key} 期望字符串，实际为 ${typeof value}`)
  return value
}

/** 读取记录中的数字字段；缺失或类型不符时抛出。 */
export function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number') throw new Error(`字段 ${key} 期望数字，实际为 ${typeof value}`)
  return value
}

/** 读取记录中的数组字段；缺失或类型不符时抛出。 */
export function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) throw new Error(`字段 ${key} 期望数组，实际为 ${typeof value}`)
  return value
}

/** 断言成功信封并返回 data 记录；data 不是对象时抛出。 */
export function expectSuccess(response: TestResponse, label = '请求'): Record<string, unknown> {
  assert.equal(response.statusCode, 200, `${label} 应返回 HTTP 200：${response.body}`)
  assert.equal(response.envelope.success, true, `${label} 应成功：${response.body}`)
  assert.equal(response.envelope.code, 'OK', `${label} 成功码应为 OK：${response.body}`)
  assert.ok(response.envelope.requestId.length > 0, `${label} 缺少 requestId`)
  return asRecord(response.envelope.data ?? {}, `${label} 的 data`)
}

/** 断言失败信封与业务错误码（HTTP 仍为 200）。 */
export function expectFailure(response: TestResponse, expectedCode: string, label = '请求'): void {
  assert.equal(response.statusCode, 200, `${label} 业务失败也应返回 HTTP 200：${response.body}`)
  assert.equal(response.envelope.success, false, `${label} 应失败：${response.body}`)
  assert.equal(response.envelope.code, expectedCode, `${label} 错误码不符：${response.body}`)
}

/** 从记录中读取列表数组；字段不是数组时抛出。 */
export function items(record: Record<string, unknown>): unknown[] {
  return arrayField(record, 'items')
}

/** 解析带日期与唯一标识的稳定排序顺序；用于分页断言。 */
export function createdAtOf(value: unknown): string {
  return stringField(asRecord(value, '列表项'), 'createdAt')
}

/** 轮询等待条件成立；超时抛出带最后一次诊断信息的错误。 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs
  const interval = options.intervalMs ?? 100
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) throw new Error(`等待超时：${options.label}`)
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

/** 允许测试跳过的原因；node:test 会把该测试标记为 skipped 并记录原因。 */
export function skipBlocked(t: TestContext, reason: string): void {
  t.skip(`blocked：${reason}`)
}

/** 探测接口是否已注册：未注册路由由平台返回 NOT_FOUND 信封。 */
export async function endpointAvailable(app: FastifyInstance, method: 'GET' | 'POST', url: string): Promise<boolean> {
  const response = await app.inject({ method, url })
  const envelope = parseEnvelope(response)
  return envelope.code !== 'NOT_FOUND'
}

/** 批量探测接口；全部注册才算就绪。 */
export async function allEndpointsAvailable(
  app: FastifyInstance,
  endpoints: Array<{ method: 'GET' | 'POST'; url: string }>,
): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = []
  for (const endpoint of endpoints) {
    if (!(await endpointAvailable(app, endpoint.method, endpoint.url))) {
      missing.push(`${endpoint.method} ${endpoint.url}`)
    }
  }
  return { ready: missing.length === 0, missing }
}

const UUID = '00000000-0000-0000-0000-000000000000'

/** 流水线平台接口的探测地址（占位参数使用固定 UUID）。 */
export const PLATFORM_ENDPOINTS = {
  workflows: { method: 'GET' as const, url: `/api/v1/projects/${UUID}/pipeline-workflows` },
  workflowDetail: { method: 'GET' as const, url: `/api/v1/projects/${UUID}/pipeline-workflows/detail?path=x` },
  trigger: { method: 'POST' as const, url: `/api/v1/projects/${UUID}/pipeline-runs` },
  runs: { method: 'GET' as const, url: `/api/v1/projects/${UUID}/pipeline-runs` },
  runDetail: { method: 'GET' as const, url: `/api/v1/pipeline-runs/${UUID}` },
  cancel: { method: 'POST' as const, url: `/api/v1/pipeline-runs/${UUID}/cancel` },
  logs: { method: 'GET' as const, url: `/api/v1/pipeline-runs/${UUID}/logs` },
  artifacts: { method: 'GET' as const, url: `/api/v1/pipeline-runs/${UUID}/artifacts` },
  artifactDownload: { method: 'GET' as const, url: `/api/v1/pipeline-artifacts/${UUID}/download` },
  nodes: { method: 'GET' as const, url: `/api/v1/teams/${UUID}/pipeline-nodes` },
  createNode: { method: 'POST' as const, url: `/api/v1/teams/${UUID}/pipeline-nodes` },
  drainNode: { method: 'POST' as const, url: `/api/v1/pipeline-nodes/${UUID}/drain` },
  disableNode: { method: 'POST' as const, url: `/api/v1/pipeline-nodes/${UUID}/disable` },
  rotateNodeToken: { method: 'POST' as const, url: `/api/v1/pipeline-nodes/${UUID}/tokens/rotate` },
  agentRegister: { method: 'POST' as const, url: '/api/v1/agent/register' },
  agentHeartbeat: { method: 'POST' as const, url: '/api/v1/agent/heartbeat' },
  agentLease: { method: 'POST' as const, url: '/api/v1/agent/lease' },
  agentRenew: { method: 'POST' as const, url: `/api/v1/agent/lease/${UUID}/renew` },
  agentStepStatus: { method: 'POST' as const, url: `/api/v1/agent/lease/${UUID}/steps/0/status` },
  agentLogs: { method: 'POST' as const, url: `/api/v1/agent/lease/${UUID}/logs` },
  agentArtifact: { method: 'POST' as const, url: `/api/v1/agent/lease/${UUID}/artifacts` },
  agentComplete: { method: 'POST' as const, url: `/api/v1/agent/lease/${UUID}/complete` },
}

/** 注入请求并解析信封。 */
export async function injectJson(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  url: string,
  options: {
    cookie?: string
    bearer?: string
    payload?: Record<string, unknown> | string
    headers?: Record<string, string>
  } = {},
): Promise<TestResponse> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.cookie) headers.cookie = options.cookie
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`
  const request = { method, url, headers }
  const response = await app.inject(options.payload === undefined ? request : { ...request, payload: options.payload })
  return { statusCode: response.statusCode, envelope: parseEnvelope(response), body: response.body }
}

/** 创建一个项目级集成测试上下文；调用方负责在测试中通过 t.after 清理。 */
export async function setupPipelineContext(t: TestContext): Promise<PipelineTestContext> {
  const runtimeValue = process.env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD
  assert.ok(runtimeValue && migrationValue && adminPassword, '请先执行 db:setup 和 db:up')
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  assert.equal(runtimeUrl.hostname, '127.0.0.1', '集成测试仅允许本机 Compose 数据库')
  assert.equal(runtimeUrl.username, 'dev_ops_app')
  assert.equal(migrationUrl.username, 'dev_ops_migrator')

  const databaseName = `dev_ops_pipeline_test_${randomBytes(8).toString('hex')}`
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  const cleanup: Array<() => Promise<unknown>> = [
    async () => admin.end(),
    async () => admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
  ]
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
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)

  const storageDir = await mkdtemp(join(tmpdir(), 'pipeline-storage-test-'))
  cleanup.push(async () => rm(storageDir, { recursive: true, force: true }))

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.PIPELINE_TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '2000',
    DB_LOCK_TIMEOUT_MS: '200',
    PIPELINE_STORAGE_DIR: storageDir,
    PIPELINE_RUN_TIMEOUT_SECONDS: '600',
    PIPELINE_LEASE_TTL_SECONDS: '30',
    PIPELINE_HEARTBEAT_TIMEOUT_SECONDS: '15',
    PIPELINE_ARTIFACT_MAX_BYTES: '1048576',
  })
  const git = createMutableFakeGit()
  const connectionId = randomUUID()
  let activeConnectionIds: string[] = [connectionId]
  const secrets = new Map<string, string>()
  let credentialIssueCount = 0
  const pipelineCredentials: PipelineCredentialProvider = {
    async issueGitCredential(repository) {
      credentialIssueCount += 1
      return {
        remoteUrl: `${repository.webUrl}.git`,
        username: 'x-access-token',
        password: 'test-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        commitSha: repository.commitSha,
      }
    },
    async resolveSecrets(input) {
      const resolved: Record<string, string> = {}
      for (const name of input.names) resolved[name] = secrets.get(name) ?? `test-secret-${name}`
      return resolved
    },
  }
  const app = createHttpApp(config, {
    mailer: new FakeMailer(),
    gitAdapterResolver: async (id) => {
      assert.equal(id, connectionId, '流水线只允许通过已关联连接读取仓库')
      return git.adapter
    },
    activeConnectionIds: async () => activeConnectionIds,
    pipelineCredentials,
  })
  cleanup.push(async () => app.close())

  const adminActor = await createAuthenticatedUser(app, { name: '管理员' })
  const developerActor = await createAuthenticatedUser(app, { name: '开发者' })
  const viewerActor = await createAuthenticatedUser(app, { name: '浏览者' })
  const strangerActor = await createAuthenticatedUser(app, { name: '团队外成员' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminActor.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminActor.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: developerActor.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerActor.userId, role: 'viewer', status: 'active' },
  ])
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '流水线测试项目',
    owner_user_id: adminActor.userId,
    created_by_user_id: adminActor.userId,
  })
  await app.db.insert(gitConnection).values({
    id: connectionId,
    team_id: teamId,
    provider_key: 'github',
    instance_url: 'https://github.com',
    name: 'GitHub',
    status: 'active',
    auth_kind: 'github_cli',
    created_by_user_id: adminActor.userId,
  })
  const repositoryId = randomUUID()
  await app.db.insert(gitRepository).values({
    id: repositoryId,
    team_id: teamId,
    connection_id: connectionId,
    provider_key: 'github',
    remote_repository_id: 'acme/app',
    namespace: 'acme',
    name: 'app',
    web_url: 'https://example.test/acme/app',
    default_branch: 'main',
  })
  const linked = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/repositories`, {
    cookie: adminActor.cookie,
    payload: { repositoryId },
  })
  assert.equal(linked.statusCode, 200, `关联仓库应返回 HTTP 200：${linked.body}`)
  assert.equal(linked.envelope.success, true, `关联仓库应成功：${linked.body}`)
  assert.ok(Array.isArray(linked.envelope.data), '关联仓库接口返回仓库列表')

  const otherTeamId = randomUUID()
  await app.db.insert(team).values({
    id: otherTeamId,
    name: `team-${randomBytes(3).toString('hex')}`,
    created_by_user_id: strangerActor.userId,
  })
  await app.db.insert(teamMember).values({
    id: randomUUID(),
    team_id: otherTeamId,
    user_id: strangerActor.userId,
    role: 'admin',
    status: 'active',
  })
  const otherProjectId = randomUUID()
  await app.db.insert(project).values({
    id: otherProjectId,
    team_id: otherTeamId,
    name: '其他团队项目',
    owner_user_id: strangerActor.userId,
    created_by_user_id: strangerActor.userId,
  })
  const otherRepositoryId = randomUUID()
  const otherConnectionId = randomUUID()
  await app.db.insert(gitConnection).values({
    id: otherConnectionId,
    team_id: otherTeamId,
    provider_key: 'github',
    instance_url: 'https://github.com',
    name: 'GitHub',
    status: 'active',
    auth_kind: 'github_cli',
    created_by_user_id: strangerActor.userId,
  })
  await app.db.insert(gitRepository).values({
    id: otherRepositoryId,
    team_id: otherTeamId,
    connection_id: otherConnectionId,
    provider_key: 'github',
    remote_repository_id: 'acme/other',
    namespace: 'acme',
    name: 'other',
    web_url: 'https://example.test/acme/other',
    default_branch: 'main',
  })
  activeConnectionIds = [connectionId, otherConnectionId]

  return {
    app,
    runtimeUrl: runtimeUrl.href,
    migrationUrl: migrationUrl.href,
    storageDir,
    git,
    credentials: {
      setSecret(name, value) {
        secrets.set(name, value)
      },
      secretNames() {
        return [...secrets.keys()]
      },
      issueCount() {
        return credentialIssueCount
      },
    },
    teamId,
    projectId,
    repositoryId,
    connectionId,
    admin: { userId: adminActor.userId, cookie: adminActor.cookie },
    developer: { userId: developerActor.userId, cookie: developerActor.cookie },
    viewer: { userId: viewerActor.userId, cookie: viewerActor.cookie },
    stranger: { userId: strangerActor.userId, cookie: strangerActor.cookie },
    otherTeam: {
      teamId: otherTeamId,
      projectId: otherProjectId,
      repositoryId: otherRepositoryId,
      admin: { userId: strangerActor.userId, cookie: strangerActor.cookie },
    },
  }
}

/** 直接插入一个在线节点；用于调度与 Agent 端点测试的前置数据。 */
export async function seedOnlineNode(
  context: PipelineTestContext,
  options: {
    name?: string
    status?: 'pending' | 'online' | 'draining' | 'offline' | 'disabled'
    capabilities?: string[]
    teamId?: string
    agentVersion?: string | null
    lastHeartbeatAt?: Date | null
  } = {},
): Promise<string> {
  const nodeId = randomUUID()
  await context.app.db.insert(pipelineNode).values({
    id: nodeId,
    team_id: options.teamId ?? context.teamId,
    name: options.name ?? `node-${randomBytes(3).toString('hex')}`,
    status: options.status ?? 'online',
    os: 'linux',
    arch: 'x64',
    capabilities: options.capabilities ?? ['linux', 'docker', 'node24'],
    concurrency_limit: 1,
    agent_version: options.agentVersion ?? '0.1.0',
    last_heartbeat_at: options.lastHeartbeatAt ?? new Date(),
    created_by_user_id: context.admin.userId,
  })
  return nodeId
}

/** 启动独立 Worker 进程；返回停止函数与已收集输出。 */
export function startWorkerProcess(context: PipelineTestContext): {
  stop: () => Promise<void>
  output: () => string
} {
  const serverDirectory = fileURLToPath(new URL('../..', import.meta.url))
  const entrypoint = join(serverDirectory, 'src/entrypoints/worker.ts')
  const child = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: context.runtimeUrl,
      AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
      APP_ORIGIN: 'http://localhost:5173',
      PIPELINE_STORAGE_DIR: context.storageDir,
      PIPELINE_RUN_TIMEOUT_SECONDS: '600',
      PIPELINE_LEASE_TTL_SECONDS: '30',
      PIPELINE_HEARTBEAT_TIMEOUT_SECONDS: '15',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    output += chunk
  })
  return {
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 5_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
    output() {
      return output
    },
  }
}

/** 读取 Worker 入口源码，用于在调度循环未实现时显式标记 blocked 而不是伪造通过。 */
export async function workerSchedulingImplemented(): Promise<boolean> {
  const source = await readFile(new URL('../../src/bootstrap/create-worker.ts', import.meta.url), 'utf8')
  return !/调度循环在 V0\.4a US2 中接入|调度循环将在 US2 接入/.test(source)
}

/** 从运行响应中读取运行标识；契约字段为 runId，兼容实现中的 id 并暴露给字段断言用例。 */
export function runIdOf(record: Record<string, unknown>): string {
  if (typeof record.runId === 'string') return record.runId
  if (typeof record.id === 'string') return record.id
  throw new Error(`运行响应缺少 runId/id：${JSON.stringify(record)}`)
}

/** 触发一次运行；成功时返回运行标识与响应 data。 */
export async function triggerRun(
  context: PipelineTestContext,
  actor: TestActor,
  input: {
    workflowPath?: string
    ref?: string
    inputs?: Record<string, unknown>
    idempotencyKey?: string
    projectId?: string
  } = {},
): Promise<{ runId: string; data: Record<string, unknown> }> {
  const projectId = input.projectId ?? context.projectId
  const response = await injectJson(context.app, 'POST', `/api/v1/projects/${projectId}/pipeline-runs`, {
    cookie: actor.cookie,
    payload: {
      workflowPath: input.workflowPath ?? '.devops/workflows/ci.yml',
      ref: input.ref ?? 'main',
      ...(input.inputs === undefined ? {} : { inputs: input.inputs }),
      idempotencyKey: input.idempotencyKey ?? `test-${randomUUID()}`,
    },
  })
  const data = expectSuccess(response, '触发运行')
  return { runId: runIdOf(data), data }
}

/** 读取运行详情。 */
export async function getRunDetail(
  context: PipelineTestContext,
  actor: TestActor,
  runId: string,
): Promise<Record<string, unknown>> {
  const response = await injectJson(context.app, 'GET', `/api/v1/pipeline-runs/${runId}`, { cookie: actor.cookie })
  return expectSuccess(response, '读取运行详情')
}

/** 列出项目运行。 */
export async function listProjectRuns(
  context: PipelineTestContext,
  actor: TestActor,
  query: Record<string, string> = {},
  projectId = context.projectId,
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(query).toString()
  const response = await injectJson(
    context.app,
    'GET',
    `/api/v1/projects/${projectId}/pipeline-runs${search ? `?${search}` : ''}`,
    { cookie: actor.cookie },
  )
  return expectSuccess(response, '列出运行')
}

/** 轮询运行详情直到状态落入期望集合；用于调度、取消、超时等异步路径。 */
export async function waitRunStatus(
  context: PipelineTestContext,
  actor: TestActor,
  runId: string,
  expected: string[],
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let latest: Record<string, unknown> = {}
  await waitFor(
    async () => {
      latest = await getRunDetail(context, actor, runId)
      return expected.includes(stringField(latest, 'status'))
    },
    { timeoutMs, label: `运行 ${runId} 状态进入 ${expected.join('/')}（最后状态 ${String(latest.status)}）` },
  )
  return latest
}

/** 创建执行节点；返回节点标识与一次性注册令牌。 */
export async function createNode(
  context: PipelineTestContext,
  actor: TestActor,
  input: { name?: string; capabilities?: string[]; teamId?: string } = {},
): Promise<{ nodeId: string; name: string; registrationToken: string | null; data: Record<string, unknown> }> {
  const teamId = input.teamId ?? context.teamId
  const response = await injectJson(context.app, 'POST', `/api/v1/teams/${teamId}/pipeline-nodes`, {
    cookie: actor.cookie,
    payload: {
      name: input.name ?? `node-${randomBytes(3).toString('hex')}`,
      capabilities: input.capabilities ?? ['linux', 'docker', 'node24'],
    },
  })
  const data = expectSuccess(response, '创建执行节点')
  const node = asRecord(data.node, '节点视图')
  const nodeId = stringField(node, 'nodeId')
  const registrationToken = typeof data.registrationToken === 'string' ? data.registrationToken : null
  return { nodeId, name: stringField(node, 'name'), registrationToken, data }
}

/** Agent 注册；返回节点标识与长期令牌。 */
export async function registerAgent(
  context: PipelineTestContext,
  input: { registrationToken: string; name?: string; capabilities?: string[]; agentVersion?: string },
): Promise<{ nodeId: string; agentToken: string }> {
  const response = await injectJson(context.app, 'POST', '/api/v1/agent/register', {
    payload: {
      registrationToken: input.registrationToken,
      name: input.name ?? `agent-${randomBytes(3).toString('hex')}`,
      os: 'linux',
      arch: 'x64',
      capabilities: input.capabilities ?? ['linux', 'docker', 'node24'],
      agentVersion: input.agentVersion ?? '0.1.0',
    },
  })
  const data = expectSuccess(response, 'Agent 注册')
  return { nodeId: stringField(data, 'nodeId'), agentToken: stringField(data, 'agentToken') }
}

/** 轮询领取一次租约；无任务时返回 null。 */
export async function pollLease(
  context: PipelineTestContext,
  agentToken: string,
  waitSeconds = 1,
): Promise<Record<string, unknown> | null> {
  const response = await injectJson(context.app, 'POST', '/api/v1/agent/lease', {
    bearer: agentToken,
    payload: { waitSeconds },
  })
  const data = response.envelope.data
  if (response.envelope.success && (data === null || data === undefined)) return null
  const record = expectSuccess(response, '领取租约')
  if (record.leaseId !== undefined) return record
  const lease = record.lease
  if (lease === null || lease === undefined) return null
  return asRecord(lease, '租约')
}

/** 启动真实监听端口并返回基础地址；用于需要原始流（产物上传）的 HTTP 用例。 */
export async function listenAndGetBaseUrl(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (typeof address !== 'object' || address === null) throw new Error('无法获取测试监听地址')
  return `http://127.0.0.1:${address.port}`
}

/** 读取失败响应的业务错误码；成功响应直接返回空字符串。 */
export function failureCode(response: TestResponse): string {
  return response.envelope.success ? '' : response.envelope.code
}

/** Agent 心跳；返回取消租约列表与心跳间隔。 */
export async function heartbeat(
  context: PipelineTestContext,
  agentToken: string,
  body: { version?: string; runningLeaseId?: string | null; capabilities?: string[] | null },
): Promise<Record<string, unknown>> {
  const response = await injectJson(context.app, 'POST', '/api/v1/agent/heartbeat', {
    bearer: agentToken,
    payload: {
      version: body.version ?? '0.1.0',
      runningLeaseId: body.runningLeaseId ?? null,
      ...(body.capabilities === undefined ? {} : { capabilities: body.capabilities }),
    },
  })
  return expectSuccess(response, 'Agent 心跳')
}

/** 续约租约；返回新的过期时间与取消标记。 */
export async function renewLease(
  context: PipelineTestContext,
  agentToken: string,
  leaseId: string,
  leaseToken: string,
): Promise<Record<string, unknown>> {
  const response = await injectJson(context.app, 'POST', `/api/v1/agent/lease/${leaseId}/renew`, {
    bearer: agentToken,
    headers: { 'x-lease-token': leaseToken },
    payload: { leaseToken },
  })
  return expectSuccess(response, '续约租约')
}

/** 上报步骤状态；返回平台当前步骤状态。 */
export async function reportStepStatus(
  context: PipelineTestContext,
  agentToken: string,
  leaseId: string,
  leaseToken: string,
  stepIndex: number,
  body: { status: string; exitCode?: number | null; errorCode?: string | null; errorMessage?: string | null },
): Promise<TestResponse> {
  return injectJson(context.app, 'POST', `/api/v1/agent/lease/${leaseId}/steps/${stepIndex}/status`, {
    bearer: agentToken,
    headers: { 'x-lease-token': leaseToken },
    payload: {
      status: body.status,
      exitCode: body.exitCode ?? null,
      errorCode: body.errorCode ?? null,
      errorMessage: body.errorMessage ?? null,
    },
  })
}

/** 上传日志分片；返回各步骤已接受的最大序号。 */
export async function uploadLogs(
  context: PipelineTestContext,
  agentToken: string,
  leaseId: string,
  leaseToken: string,
  chunks: Array<{ stepIndex: number; seq: number; content: string }>,
): Promise<TestResponse> {
  return injectJson(context.app, 'POST', `/api/v1/agent/lease/${leaseId}/logs`, {
    bearer: agentToken,
    headers: { 'x-lease-token': leaseToken },
    payload: { chunks },
  })
}

/** 完成租约上报；返回运行终态。 */
export async function completeLease(
  context: PipelineTestContext,
  agentToken: string,
  leaseId: string,
  leaseToken: string,
  body: { status: string; errorCode?: string | null; errorMessage?: string | null },
): Promise<TestResponse> {
  return injectJson(context.app, 'POST', `/api/v1/agent/lease/${leaseId}/complete`, {
    bearer: agentToken,
    headers: { 'x-lease-token': leaseToken },
    payload: {
      status: body.status,
      errorCode: body.errorCode ?? null,
      errorMessage: body.errorMessage ?? null,
    },
  })
}

/** 产物上传响应结构；测试只断言契约字段。 */
export interface ArtifactUploadResult {
  artifactId: string
  name: string
  sizeBytes: number
  sha256: string
}

/** 通过监听端口上传原始产物字节；返回契约字段。 */
export async function uploadArtifact(
  baseUrl: string,
  agentToken: string,
  leaseId: string,
  leaseToken: string,
  input: { stepIndex: number; name: string; content: Buffer; sha256?: string },
): Promise<ArtifactUploadResult> {
  const response = await fetch(`${baseUrl}/api/v1/agent/lease/${leaseId}/artifacts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agentToken}`,
      'x-lease-token': leaseToken,
      'x-step-index': String(input.stepIndex),
      'x-artifact-name': encodeURIComponent(input.name),
      'x-content-sha256': input.sha256 ?? createHash('sha256').update(input.content).digest('hex'),
      'content-type': 'application/octet-stream',
    },
    body: input.content,
  })
  const body = await response.text()
  const envelope = parseEnvelope({ json: () => JSON.parse(body), body })
  const data = expectSuccess({ statusCode: response.status, envelope, body }, '上传产物')
  return {
    artifactId: stringField(data, 'artifactId'),
    name: stringField(data, 'name'),
    sizeBytes: numberField(data, 'sizeBytes'),
    sha256: stringField(data, 'sha256'),
  }
}

/** 将除保留节点之外的节点置为离线，保证调度用例之间互不干扰。 */
export async function offlineOtherNodes(context: PipelineTestContext, keepNodeIds: string[]): Promise<void> {
  if (keepNodeIds.length === 0) {
    await context.app.db.update(pipelineNode).set({ status: 'offline' })
    return
  }
  const { notInArray } = await import('drizzle-orm')
  await context.app.db.update(pipelineNode).set({ status: 'offline' }).where(notInArray(pipelineNode.id, keepNodeIds))
}

/** 注册一个在线节点并返回其 Agent 凭据。 */
export async function startNode(
  context: PipelineTestContext,
  input: { capabilities?: string[]; agentVersion?: string } = {},
): Promise<{ nodeId: string; name: string; agentToken: string }> {
  const node = await createNode(context, context.admin, { capabilities: input.capabilities })
  if (node.registrationToken === null) throw new Error('创建节点未返回注册令牌')
  const agent = await registerAgent(context, {
    registrationToken: node.registrationToken,
    name: node.name,
    capabilities: input.capabilities,
    agentVersion: input.agentVersion,
  })
  return { nodeId: node.nodeId, name: node.name, agentToken: agent.agentToken }
}

/**
 * 准备一个已领取租约的运行：创建并注册节点、仅保留该节点在线、触发运行、调度并领取租约。
 * @returns 节点、Agent 令牌、运行与租约凭证。
 */
export async function prepareRunningLease(
  context: PipelineTestContext,
  input: { capabilities?: string[]; workflowPath?: string } = {},
): Promise<{
  nodeId: string
  name: string
  agentToken: string
  runId: string
  leaseId: string
  leaseToken: string
  lease: Record<string, unknown>
}> {
  const node = await startNode(context, input)
  await offlineOtherNodes(context, [node.nodeId])
  await cancelQueuedRuns(context)
  const run = await triggerRun(context, context.developer, {
    ...(input.workflowPath ? { workflowPath: input.workflowPath } : {}),
    idempotencyKey: `lease-${randomUUID()}`,
  })
  const scheduler = createPipelineSchedulerForTest(context)
  const cycle = await scheduler.runCycle()
  assert.equal(cycle.scheduledRuns >= 1, true, '调度周期应至少分配一条运行')
  const lease = await pollLease(context, node.agentToken, 1)
  if (!lease) throw new Error('Agent 应能领取租约')
  const leasePlan = asRecord(lease.run, '租约运行计划')
  if (stringField(leasePlan, 'runId') !== run.runId) {
    throw new Error(`Agent 领取到其他运行的租约：期望 ${run.runId}，实际 ${stringField(leasePlan, 'runId')}`)
  }
  return {
    nodeId: node.nodeId,
    name: node.name,
    agentToken: node.agentToken,
    runId: run.runId,
    leaseId: stringField(lease, 'leaseId'),
    leaseToken: stringField(lease, 'leaseToken'),
    lease,
  }
}

/** 把当前所有排队运行收口为 cancelled，避免历史用例的排队任务干扰后续调度。 */
export async function cancelQueuedRuns(context: PipelineTestContext): Promise<void> {
  await context.app.db
    .update(pipelineRun)
    .set({ status: 'cancelled', finished_at: new Date(), error_code: 'CANCELLED', error_message: '测试清场' })
    .where(eq(pipelineRun.status, 'queued'))
}

/** 进程内创建调度器；测试直接驱动 runCycle，不启动 Worker 进程。 */
export function createPipelineSchedulerForTest(context: PipelineTestContext) {
  return createPipelineScheduler({
    db: context.app.db,
    config: { leaseTtlSeconds: 30, heartbeatTimeoutSeconds: 15 },
    log: () => undefined,
  })
}
