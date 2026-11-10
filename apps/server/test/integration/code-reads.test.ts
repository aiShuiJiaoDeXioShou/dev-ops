import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { count } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import {
  GitAdapterError,
  type GitAdapter,
  type GitCommitDetail,
  type GitCommitFile,
  type GitCommitSummary,
  type GitPullRequestDetail,
  type GitPullRequestFile,
  type GitPullRequestSummary,
} from '../../src/adapters/git/git.types.ts'
import { filterPullRequestsByAuthor } from '../../src/adapters/git/git.normalize.ts'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.ts'
import { codeReference, gitRepository } from '../../src/modules/code/code.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

const commit: GitCommitSummary = {
  sha: '0123456789abcdef0123456789abcdef01234567',
  title: 'feat: 登录',
  authorName: 'Alice',
  committedAt: '2026-11-09T10:00:00Z',
  url: 'https://example.test/commit/0123456789abcdef0123456789abcdef01234567',
}
const commitFiles: GitCommitFile[] = [
  { path: 'src/login.ts', status: 'modified', additions: 10, deletions: 2 },
  { path: 'assets/logo.png', status: 'added', additions: 0, deletions: 0 },
]
const commitDetail: GitCommitDetail = { ...commit, files: commitFiles, filesTruncated: false, filesUnsupported: false }
const pullRequestSummary: GitPullRequestSummary = {
  number: 8,
  title: 'feat: 登录',
  authorName: 'alice',
  sourceBranch: 'feat/login',
  targetBranch: 'main',
  state: 'open',
  reviewStatus: 'approved',
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
  mergedAt: null,
  url: 'https://example.test/pull/8',
}
const otherPullRequestSummary: GitPullRequestSummary = {
  number: 9,
  title: 'fix: 登出',
  authorName: 'bob',
  sourceBranch: 'fix/logout',
  targetBranch: 'main',
  state: 'open',
  reviewStatus: 'pending',
  createdAt: '2026-11-07T10:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
  mergedAt: null,
  url: 'https://example.test/pull/9',
}
const pullRequestFiles: GitPullRequestFile[] = [
  {
    path: 'src/login.ts',
    status: 'modified',
    additions: 10,
    deletions: 2,
    patch: '@@ -1 +1 @@',
    binary: false,
    truncated: false,
  },
  { path: 'assets/logo.png', status: 'added', additions: 0, deletions: 0, patch: null, binary: true, truncated: false },
]
const pullRequestDetail: GitPullRequestDetail = { ...pullRequestSummary, files: pullRequestFiles, truncated: false }

/** 断言时间字段是可由 Date 解析的 ISO 字符串。 */
function assertIsoTimestamp(value: unknown) {
  assert.equal(typeof value, 'string')
  assert.ok(!Number.isNaN(Date.parse(String(value))), `时间字段不合法：${String(value)}`)
}

test('代码提交与 PR 读取：权限、分页、筛选、来源失败分类、截断与空结果', { timeout: 90_000 }, async (t) => {
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

  const connectionId = randomUUID()
  let failure: GitAdapterError | null = null
  let emptyResults = false
  let commitDetailResult: GitCommitDetail = commitDetail
  let lastCommitDetailRef: string | undefined
  let lastCommitsRef: string | undefined
  let lastCommitsPage: number | undefined
  let lastCommitsPageSize: number | undefined
  let lastPullRequestState: string | undefined
  let lastPullRequestAuthor: string | undefined
  let listPullRequestsCalls = 0
  const throwIfFailure = () => {
    if (failure) throw failure
  }
  const adapter: GitAdapter = {
    async checkConnection() {
      return { identity: 'fake' }
    },
    async listRepositories() {
      return []
    },
    async getObject() {
      return { objectType: 'commit', remoteId: 'x', title: 'x', state: 'available', url: null }
    },
    async listCommits(input) {
      lastCommitsRef = input.ref
      lastCommitsPage = input.page
      lastCommitsPageSize = input.pageSize
      throwIfFailure()
      return emptyResults ? [] : [commit]
    },
    async getCommit(input) {
      lastCommitDetailRef = input.ref
      throwIfFailure()
      if (input.ref === 'missing') throw new GitAdapterError('not_found', '远端记录不存在')
      return commitDetailResult
    },
    async listPullRequests(input) {
      listPullRequestsCalls += 1
      lastPullRequestState = input.state
      lastPullRequestAuthor = input.author
      throwIfFailure()
      if (emptyResults) return []
      return filterPullRequestsByAuthor([pullRequestSummary, otherPullRequestSummary], input.author)
    },
    async getPullRequest(input) {
      throwIfFailure()
      if (input.number === 999) throw new GitAdapterError('not_found', '远端记录不存在')
      return pullRequestDetail
    },
    async getPullRequestDiff(input) {
      throwIfFailure()
      if (input.number === 999) throw new GitAdapterError('not_found', '远端记录不存在')
      return { patch: '@@ -1 +1 @@\n-old\n+new', truncated: false }
    },
  }
  // 模拟旧适配器或来源能力缺失：只有基础端口，不实现提交与 PR 读取。
  const minimalAdapter: GitAdapter = {
    async checkConnection() {
      return { identity: 'fake' }
    },
    async listRepositories() {
      return []
    },
    async getObject() {
      return { objectType: 'commit', remoteId: 'x', title: 'x', state: 'available', url: null }
    },
  }
  let currentAdapter: GitAdapter = adapter
  let activeConnectionIds: string[] = [connectionId]
  const app = createHttpApp(config, {
    mailer: new FakeMailer(),
    gitAdapterResolver: async (id) => {
      assert.equal(id, connectionId)
      return currentAdapter
    },
    activeConnectionIds: async () => activeConnectionIds,
  })
  cleanup.push(async () => {
    await app.close()
  })

  const adminUser = await createAuthenticatedUser(app, { name: '管理员' })
  const developerUser = await createAuthenticatedUser(app, { name: '开发者' })
  const viewerUser = await createAuthenticatedUser(app, { name: '浏览者' })
  const strangerUser = await createAuthenticatedUser(app, { name: '团队外成员' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: developerUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
  ])
  const projectId = randomUUID()
  await app.db.insert(project).values({
    id: projectId,
    team_id: teamId,
    name: '代码读取项目',
    owner_user_id: adminUser.userId,
    created_by_user_id: adminUser.userId,
  })
  await app.db.insert(gitConnection).values({
    id: connectionId,
    team_id: teamId,
    provider_key: 'github',
    instance_url: 'https://github.com',
    name: 'GitHub',
    status: 'active',
    auth_kind: 'github_cli',
    created_by_user_id: adminUser.userId,
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
    web_url: 'https://github.com/acme/app',
    default_branch: 'main',
  })
  // 同团队但未关联到项目的仓库，用于验证未关联仓库被拒绝。
  const unlinkedRepositoryId = randomUUID()
  await app.db.insert(gitRepository).values({
    id: unlinkedRepositoryId,
    team_id: teamId,
    connection_id: connectionId,
    provider_key: 'github',
    remote_repository_id: 'acme/other',
    namespace: 'acme',
    name: 'other',
    web_url: 'https://github.com/acme/other',
    default_branch: 'main',
  })
  const linked = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/repositories`,
    payload: { repositoryId },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(linked.json().success, true, linked.body)

  // 事项与远端 PR/提交的关联数据：只有 change_request 关联能用于 PR 列表过滤。
  const linkedTargetId = randomUUID()
  const unusedTargetId = randomUUID()
  const referenceBase = {
    team_id: teamId,
    project_id: projectId,
    repository_id: repositoryId,
    target_type: 'requirement',
    last_checked_at: new Date(),
    last_check_status: 'ok',
    created_by_user_id: adminUser.userId,
  }
  await app.db.insert(codeReference).values([
    {
      ...referenceBase,
      id: randomUUID(),
      target_id: linkedTargetId,
      object_type: 'change_request',
      remote_id: '9',
      title_snapshot: 'fix: 登出',
      state_snapshot: 'open',
      url: 'https://example.test/pull/9',
    },
    {
      ...referenceBase,
      id: randomUUID(),
      target_id: linkedTargetId,
      object_type: 'commit',
      remote_id: '8',
      title_snapshot: 'feat: 登录',
      state_snapshot: 'available',
      url: null,
    },
    {
      ...referenceBase,
      id: randomUUID(),
      target_id: unusedTargetId,
      object_type: 'change_request',
      remote_id: '8',
      title_snapshot: 'feat: 登录',
      state_snapshot: 'open',
      url: 'https://example.test/pull/8',
    },
  ])

  const baseUrl = `/api/v1/projects/${projectId}/repositories/${repositoryId}`

  // 只读访问令牌（Bearer）继承账号权限，浏览者令牌可读取。
  const tokenResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/me/tokens',
    payload: { name: '读取令牌' },
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(tokenResponse.json().success, true, tokenResponse.body)
  const token = tokenResponse.json().data.token
  assert.equal(typeof token, 'string')

  // 基线在全部前置写入之后取样，用于断言后续读取不产生活动记录。
  const readOnlyBaseline = await app.db.select({ value: count() }).from(activity)

  // 未登录读取被拒绝。
  const anonymous = await app.inject({ method: 'GET', url: `${baseUrl}/commits` })
  assert.equal(anonymous.statusCode, 200)
  assert.equal(anonymous.json().success, false)
  assert.equal(anonymous.json().code, 'UNAUTHENTICATED')

  // 浏览者可以读取提交列表，ref 缺省使用仓库默认分支，信封、分页与最近核对时间稳定。
  const commitsResponse = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits?page=1&pageSize=20`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(commitsResponse.statusCode, 200, commitsResponse.body)
  const commitsBody = commitsResponse.json()
  assert.equal(commitsBody.success, true)
  assert.equal(commitsBody.code, 'OK')
  assert.equal(typeof commitsBody.requestId, 'string')
  assert.equal(commitsBody.data.items.length, 1)
  const commitItem = commitsBody.data.items[0]
  assert.equal(commitItem.sha, commit.sha)
  assert.equal(commitItem.title, commit.title)
  assert.equal(commitItem.authorName, commit.authorName)
  assert.equal(commitItem.committedAt, commit.committedAt)
  assert.equal(commitItem.url, commit.url)
  assertIsoTimestamp(commitItem.lastCheckedAt)
  // 列表不读取变更文件，不返回 files 字段，避免与“没有变更”混淆。
  assert.equal(commitItem.files, undefined)
  assert.equal(commitsBody.data.page, 1)
  assert.equal(commitsBody.data.pageSize, 20)
  assert.equal(commitsBody.data.total, 1)
  assert.equal(lastCommitsRef, 'main')
  assert.equal(lastCommitsPage, 1)
  assert.equal(lastCommitsPageSize, 20)

  const tokenRead = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits`,
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(tokenRead.json().success, true)
  assert.equal(tokenRead.json().data.items[0].sha, commit.sha)

  // 提交详情与不存在区分：来源 not_found 映射为 NOT_FOUND，不返回空对象。
  const commitDetailResponse = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits/${commit.sha}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(commitDetailResponse.json().success, true, commitDetailResponse.body)
  const commitDetailBody = commitDetailResponse.json().data
  assert.equal(commitDetailBody.sha, commit.sha)
  assert.deepEqual(commitDetailBody.files, commitFiles)
  assert.equal(commitDetailBody.filesTruncated, false)
  assert.equal(commitDetailBody.filesUnsupported, false)
  assertIsoTimestamp(commitDetailBody.lastCheckedAt)

  // 来源不提供提交变更文件时明确标记不支持，不显示为空文件。
  commitDetailResult = { ...commitDetail, files: [], filesUnsupported: true }
  const unsupportedCommitFiles = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits/${commit.sha}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(unsupportedCommitFiles.json().data.filesUnsupported, true)
  assert.deepEqual(unsupportedCommitFiles.json().data.files, [])
  commitDetailResult = commitDetail

  const missingCommit = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits/missing`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(missingCommit.json().code, 'NOT_FOUND')
  const invalidRef = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits/bad%24ref`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidRef.json().code, 'VALIDATION_ERROR')
  // 分支名中的斜杠需编码为 %2F，服务端解码后按来源稳定标识读取。
  const branchCommit = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits/feature%2Flogin`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(branchCommit.json().success, true, branchCommit.body)
  assert.equal(lastCommitDetailRef, 'feature/login')

  // PR 列表默认仅 open；每项带最近核对时间，且列表不加载变更文件。
  const pullRequests = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?page=1&pageSize=10`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(pullRequests.json().success, true, pullRequests.body)
  assert.equal(lastPullRequestState, 'open')
  assert.equal(pullRequests.json().data.items.length, 2)
  for (const item of pullRequests.json().data.items) {
    assertIsoTimestamp(item.lastCheckedAt)
    assert.deepEqual(item.files, [])
    assert.equal(item.truncated, false)
  }
  assert.equal(pullRequests.json().data.total, 2)

  // 状态筛选透传到适配器；非法状态与页大小被入口拒绝。
  const closedPullRequests = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?state=closed&page=1&pageSize=10`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(closedPullRequests.json().success, true)
  assert.equal(lastPullRequestState, 'closed')
  const invalidState = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?state=merged`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidState.json().code, 'VALIDATION_ERROR')
  const invalidPageSize = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?pageSize=101`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidPageSize.json().code, 'VALIDATION_ERROR')
  const invalidAuthor = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?author=${encodeURIComponent('x'.repeat(201))}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidAuthor.json().code, 'VALIDATION_ERROR')
  const invalidLinkedTarget = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?linkedTargetId=not-a-uuid`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidLinkedTarget.json().code, 'VALIDATION_ERROR')

  // 作者筛选透传到适配器，按来源作者名过滤。
  const authorPullRequests = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?author=bob`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(authorPullRequests.json().success, true)
  assert.equal(lastPullRequestAuthor, 'bob')
  assert.equal(authorPullRequests.json().data.items.length, 1)
  assert.equal(authorPullRequests.json().data.items[0].number, 9)

  // 关联事项筛选：平台内查 change_request 引用（忽略 commit 引用），默认返回全部状态。
  const linkedPullRequests = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?linkedTargetId=${linkedTargetId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(linkedPullRequests.json().success, true, linkedPullRequests.body)
  assert.equal(lastPullRequestState, 'all')
  assert.equal(linkedPullRequests.json().data.items.length, 1)
  assert.equal(linkedPullRequests.json().data.items[0].number, 9)
  assert.equal(linkedPullRequests.json().data.total, 1)

  // 未关联任何 PR 的事项返回成功空列表，且不请求来源。
  const callsBeforeUnlinkedTarget = listPullRequestsCalls
  const emptyLinkedPullRequests = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests?linkedTargetId=${randomUUID()}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(emptyLinkedPullRequests.json().success, true)
  assert.deepEqual(emptyLinkedPullRequests.json().data.items, [])
  assert.equal(emptyLinkedPullRequests.json().data.total, 0)
  assert.equal(listPullRequestsCalls, callsBeforeUnlinkedTarget)

  // PR 详情包含评审状态、变更文件、截断标记与最近核对时间；PR 差异返回文本。
  const pullRequestDetailResponse = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests/8`,
    headers: { cookie: developerUser.cookie },
  })
  assert.equal(pullRequestDetailResponse.json().success, true, pullRequestDetailResponse.body)
  const pullRequestDetailBody = pullRequestDetailResponse.json().data
  assert.equal(pullRequestDetailBody.number, 8)
  assert.equal(pullRequestDetailBody.reviewStatus, 'approved')
  assert.equal(pullRequestDetailBody.sourceBranch, 'feat/login')
  assert.deepEqual(pullRequestDetailBody.files, pullRequestFiles)
  assert.equal(pullRequestDetailBody.truncated, false)
  assertIsoTimestamp(pullRequestDetailBody.lastCheckedAt)
  const invalidNumber = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests/0`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidNumber.json().code, 'VALIDATION_ERROR')
  const missingPullRequest = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests/999`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(missingPullRequest.json().code, 'NOT_FOUND')
  const diff = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests/8/diff`,
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(diff.json().success, true)
  assert.equal(diff.json().data.patch, '@@ -1 +1 @@\n-old\n+new')
  assert.equal(diff.json().data.truncated, false)

  // 未关联仓库与团队外成员被拒绝，不泄露其他团队数据。
  const unlinked = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/repositories/${unlinkedRepositoryId}/commits`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(unlinked.json().code, 'NOT_FOUND')
  const stranger = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits`,
    headers: { cookie: strangerUser.cookie },
  })
  assert.equal(stranger.json().code, 'FORBIDDEN')

  // 来源失败必须分类返回，不能用空列表或成功状态冒充。
  const failureCases: Array<[GitAdapterError, string]> = [
    [new GitAdapterError('auth_failed', '授权失败'), 'EXTERNAL_AUTH_FAILED'],
    [new GitAdapterError('timeout', '超时'), 'EXTERNAL_UNAVAILABLE'],
    [new GitAdapterError('unavailable', '来源不可用'), 'EXTERNAL_UNAVAILABLE'],
    [new GitAdapterError('invalid_response', '响应不合法'), 'EXTERNAL_UNAVAILABLE'],
    [new GitAdapterError('unsupported', '能力不支持'), 'EXTERNAL_UNSUPPORTED'],
    [new GitAdapterError('not_found', '记录不存在'), 'NOT_FOUND'],
  ]
  for (const [error, expectedCode] of failureCases) {
    failure = error
    const response = await app.inject({
      method: 'GET',
      url: `${baseUrl}/commits`,
      headers: { cookie: viewerUser.cookie },
    })
    assert.equal(response.json().success, false, `失败码 ${expectedCode} 不得返回成功`)
    assert.equal(response.json().code, expectedCode)
    assert.equal(response.json().data, undefined)
  }
  failure = new GitAdapterError('auth_failed', '授权失败')
  const failedPullRequests = await app.inject({
    method: 'GET',
    url: `${baseUrl}/pull-requests`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(failedPullRequests.json().code, 'EXTERNAL_AUTH_FAILED')
  failure = null

  // 空结果与失败可区分：没有数据时返回成功与空列表。
  emptyResults = true
  const emptyCommits = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(emptyCommits.json().success, true)
  assert.deepEqual(emptyCommits.json().data.items, [])
  assert.equal(emptyCommits.json().data.total, 0)
  emptyResults = false

  // 适配器缺少能力时返回 EXTERNAL_UNSUPPORTED，不返回空列表。
  currentAdapter = minimalAdapter
  const unsupportedEndpoints = [
    `${baseUrl}/commits`,
    `${baseUrl}/commits/${commit.sha}`,
    `${baseUrl}/pull-requests`,
    `${baseUrl}/pull-requests/8`,
    `${baseUrl}/pull-requests/8/diff`,
  ]
  for (const url of unsupportedEndpoints) {
    const response = await app.inject({ method: 'GET', url, headers: { cookie: viewerUser.cookie } })
    assert.equal(response.json().code, 'EXTERNAL_UNSUPPORTED', `${url} 应标记能力不支持`)
  }
  currentAdapter = adapter

  // 连接被移除或撤权后读取被拒绝，不回退到旧数据。
  activeConnectionIds = []
  const inactive = await app.inject({
    method: 'GET',
    url: `${baseUrl}/commits`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(inactive.json().code, 'PRECONDITION_FAILED')
  activeConnectionIds = [connectionId]

  // 读取全部为只读：不写入活动或其他业务记录。
  const readOnlyAfter = await app.db.select({ value: count() }).from(activity)
  assert.equal(readOnlyAfter[0]?.value, readOnlyBaseline[0]?.value, '代码读取不得产生活动记录')
})
