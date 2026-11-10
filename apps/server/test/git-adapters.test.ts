import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGitHubCliAdapter } from '../src/adapters/git/github-cli.adapter.ts'
import { createGitHubAppAdapter, type GitHubAppClient } from '../src/adapters/git/github.adapter.ts'
import { createGiteaAdapter, type GiteaFetch } from '../src/adapters/git/gitea.adapter.ts'
import { createGitAdapter } from '../src/adapters/git/git.registry.ts'
import { GitAdapterError, type GitAdapter } from '../src/adapters/git/git.types.ts'
import { loadConfig } from '../src/platform/config/env.ts'

const baseInput = { provider: 'github' as const, authKind: 'github_cli' as const, instanceUrl: 'https://github.com' }
const allowed = ['aiShuiJiaoDeXioShou/dev-ops']

test('GitHub CLI 适配器只接受 allowlist、固定只读命令并映射错误', async () => {
  const calls: string[][] = []
  const adapter = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: allowed,
    exec: async (args) => {
      calls.push(args)
      const joined = args.join(' ')
      if (joined === 'api user --jq .login') return { stdout: 'aiShuiJiaoDeXioShou\n', stderr: '' }
      if (joined.startsWith('repo view'))
        return {
          stdout: JSON.stringify({
            nameWithOwner: allowed[0],
            url: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops',
            defaultBranchRef: { name: 'main' },
          }),
          stderr: '',
        }
      if (joined.startsWith('api repos/aiShuiJiaoDeXioShou/dev-ops/issues/12'))
        return {
          stdout: JSON.stringify({
            title: '登录失败',
            state: 'open',
            html_url: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops/issues/12',
          }),
          stderr: '',
        }
      if (joined.startsWith('api repos/aiShuiJiaoDeXioShou/dev-ops/commits/'))
        return {
          stdout: JSON.stringify({
            html_url: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops/commit/abc',
            commit: { message: 'fix: login\n\nbody' },
          }),
          stderr: '',
        }
      return { stdout: JSON.stringify({ title: 'PR', state: 'open' }), stderr: '' }
    },
  })

  assert.deepEqual(await adapter.checkConnection(), { identity: 'aiShuiJiaoDeXioShou' })
  const repositories = await adapter.listRepositories()
  assert.equal(repositories.length, 1)
  assert.equal(repositories[0]?.namespace, 'aiShuiJiaoDeXioShou')
  const issue = await adapter.getObject({
    repository: { namespace: 'aiShuiJiaoDeXioShou', name: 'dev-ops' },
    objectType: 'issue',
    remoteId: '12',
  })
  assert.equal(issue.title, '登录失败')
  const commit = await adapter.getObject({
    repository: { namespace: 'aiShuiJiaoDeXioShou', name: 'dev-ops' },
    objectType: 'commit',
    remoteId: 'abcdef1',
  })
  assert.equal(commit.title, 'fix: login')
  await assert.rejects(
    adapter.getObject({ repository: { namespace: 'evil', name: 'repo' }, objectType: 'issue', remoteId: '1' }),
    (error: unknown) => error instanceof GitAdapterError && error.code === 'unsupported',
  )
  await assert.rejects(
    adapter.getObject({
      repository: { namespace: 'aiShuiJiaoDeXioShou', name: 'dev-ops' },
      objectType: 'issue',
      remoteId: '../../admin',
    }),
    (error: unknown) => error instanceof GitAdapterError && error.code === 'unsupported',
  )
  assert.ok(calls.every((args) => !args.some((arg) => arg.includes('shell') || arg.includes('--method'))))
})

test('GitHub CLI 超时与授权错误分类', async () => {
  const timeoutAdapter = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: allowed,
    exec: async () => {
      throw Object.assign(new Error('timeout'), { killed: true })
    },
  })
  await assert.rejects(
    timeoutAdapter.checkConnection(),
    (error: unknown) => error instanceof GitAdapterError && error.code === 'timeout',
  )

  const authAdapter = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: allowed,
    exec: async () => {
      throw Object.assign(new Error('HTTP 401'), { stderr: 'HTTP 401: Bad credentials' })
    },
  })
  await assert.rejects(
    authAdapter.checkConnection(),
    (error: unknown) => error instanceof GitAdapterError && error.code === 'auth_failed',
  )
})

test('GitHub App 适配器使用安装身份、过滤 allowlist 并映射错误', async () => {
  const routes: string[] = []
  const client: GitHubAppClient = {
    async request(route) {
      routes.push(route)
      if (route === 'GET /installation') return { data: { account: { login: 'aiShuiJiaoDeXioShou' } } }
      if (route === 'GET /installation/repositories') {
        return {
          data: {
            repositories: [
              {
                id: 1,
                full_name: 'aiShuiJiaoDeXioShou/dev-ops',
                html_url: 'https://github.com/aiShuiJiaoDeXioShou/dev-ops',
                default_branch: 'main',
              },
              { id: 2, full_name: 'other/repo', html_url: 'https://github.com/other/repo', default_branch: 'main' },
            ],
          },
        }
      }
      if (route.includes('/issues/'))
        return { data: { title: 'Bug', state: 'open', html_url: 'https://example.test/issues/3' } }
      return { data: {} }
    },
  }
  const adapter = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    allowedRepositories: allowed,
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client,
  })
  assert.deepEqual(await adapter.checkConnection(), { identity: 'aiShuiJiaoDeXioShou' })
  const repositories = await adapter.listRepositories()
  assert.equal(repositories.length, 1)
  assert.equal(repositories[0]?.name, 'dev-ops')
  assert.equal(routes[0], 'GET /installation')

  const failing: GitHubAppClient = {
    async request() {
      throw Object.assign(new Error('auth'), { status: 401 })
    },
  }
  const failedAdapter = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client: failing,
  })
  await assert.rejects(
    failedAdapter.checkConnection(),
    (error: unknown) => error instanceof GitAdapterError && error.code === 'auth_failed',
  )
})

test('Gitea 适配器分页、Token 头与状态错误映射', async () => {
  const urls: string[] = []
  const adapter = createGiteaAdapter({
    provider: 'gitea',
    authKind: 'gitea_token',
    instanceUrl: 'https://gitea.example.test/',
    token: 'token',
    fetch: async (url, init) => {
      urls.push(url)
      assert.match(String((init.headers as Record<string, string>).Authorization), /^token token$/)
      if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'bot' }), { status: 200 })
      if (url.includes('/repos/search'))
        return new Response(
          JSON.stringify({
            data: [
              { id: 5, full_name: 'ops/app', html_url: 'https://gitea.example.test/ops/app', default_branch: 'main' },
            ],
          }),
          { status: 200 },
        )
      if (url.includes('/issues/9'))
        return new Response(
          JSON.stringify({ title: '问题', state: 'open', html_url: 'https://gitea.example.test/ops/app/issues/9' }),
          { status: 200 },
        )
      return new Response('{}', { status: 200 })
    },
  })
  assert.deepEqual(await adapter.checkConnection(), { identity: 'bot' })
  const repositories = await adapter.listRepositories()
  assert.equal(repositories[0]?.webUrl, 'https://gitea.example.test/ops/app')
  const issue = await adapter.getObject({
    repository: { namespace: 'ops', name: 'app' },
    objectType: 'issue',
    remoteId: '9',
  })
  assert.equal(issue.title, '问题')
  assert.ok(urls.some((url) => url.startsWith('https://gitea.example.test/api/v1/repos/search')))

  const notFound = createGiteaAdapter({
    provider: 'gitea',
    authKind: 'gitea_token',
    instanceUrl: 'https://gitea.example.test',
    token: 'token',
    fetch: async () => new Response('{}', { status: 404 }),
  })
  await assert.rejects(
    notFound.checkConnection(),
    (error: unknown) => error instanceof GitAdapterError && error.code === 'not_found',
  )
})

test('注册表根据 GITHUB_AUTH_MODE 选择适配器', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test@127.0.0.1:1/test',
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GITHUB_AUTH_MODE: 'cli',
    GITHUB_ALLOWED_REPOS: allowed[0],
  })
  const cli = createGitAdapter(config, baseInput, {
    githubCli: () => ({
      checkConnection: async () => ({ identity: 'cli' }),
      listRepositories: async () => [],
      getObject: async () => ({ objectType: 'issue', remoteId: '1', title: '', state: 'open', url: null }),
    }),
  })
  assert.equal((await cli.checkConnection()).identity, 'cli')

  const appConfig = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test@127.0.0.1:1/test',
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GITHUB_AUTH_MODE: 'app',
    GITHUB_ALLOWED_REPOS: allowed[0],
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY_PATH: '/tmp/key.pem',
    GITHUB_APP_SLUG: 'dev-ops',
  })
  const app = createGitAdapter(appConfig, baseInput, {
    githubApp: () => ({
      checkConnection: async () => ({ identity: 'app' }),
      listRepositories: async () => [],
      getObject: async () => ({ objectType: 'issue', remoteId: '1', title: '', state: 'open', url: null }),
    }),
  })
  assert.equal((await app.checkConnection()).identity, 'app')
})

/** 读取端口可选方法齐全的测试断言；避免在调用处使用非空断言。 */
type RequiredReadAdapter = Required<
  Pick<GitAdapter, 'listCommits' | 'getCommit' | 'listPullRequests' | 'getPullRequest' | 'getPullRequestDiff'>
>

function hasReadMethods(adapter: GitAdapter): adapter is GitAdapter & RequiredReadAdapter {
  return Boolean(
    adapter.listCommits &&
    adapter.getCommit &&
    adapter.listPullRequests &&
    adapter.getPullRequest &&
    adapter.getPullRequestDiff,
  )
}

/** 断言适配器错误码。 */
function rejectsWithCode(code: string) {
  return (error: unknown) => error instanceof GitAdapterError && error.code === code
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const readAllowed = ['acme/app']
const readRepository = { namespace: 'acme', name: 'app' }
const githubCommit = {
  sha: '0123456789abcdef0123456789abcdef01234567',
  html_url: 'https://github.com/acme/app/commit/0123456789abcdef0123456789abcdef01234567',
  commit: { message: 'feat: 登录\n\n正文', author: { name: 'Alice', date: '2026-11-09T10:00:00Z' } },
  files: [
    { filename: 'src/login.ts', status: 'modified', additions: 10, deletions: 2 },
    { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
  ],
}
const githubPullRequest = {
  number: 8,
  title: 'feat: 登录',
  state: 'closed',
  merged_at: '2026-11-09T12:00:00Z',
  user: { login: 'alice' },
  head: { ref: 'feat/login' },
  base: { ref: 'main' },
  created_at: '2026-11-08T10:00:00Z',
  updated_at: '2026-11-09T12:00:00Z',
  html_url: 'https://github.com/acme/app/pull/8',
}
const githubPullRequestOther = {
  number: 9,
  title: 'fix: 登出',
  state: 'open',
  merged_at: null,
  user: { login: 'bob' },
  head: { ref: 'fix/logout' },
  base: { ref: 'main' },
  created_at: '2026-11-07T10:00:00Z',
  updated_at: '2026-11-08T10:00:00Z',
  html_url: 'https://github.com/acme/app/pull/9',
}
const githubReviews = [
  { id: 1, user: { login: 'bob' }, state: 'APPROVED', submitted_at: '2026-11-09T09:00:00Z' },
  { id: 2, user: { login: 'carol' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-09T10:00:00Z' },
]
const oversizedPatch = 'x'.repeat(100 * 1024 + 1)
const githubFiles = [
  { filename: 'src/login.ts', status: 'modified', additions: 10, deletions: 2, patch: '@@ -1 +1 @@\n-old\n+new' },
  { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
  { filename: 'docs/big.md', status: 'modified', additions: 1, deletions: 1, patch: oversizedPatch },
]
// 超过 1MB 的差异文本，用于验证返回前缀并标记截断。
const oversizedDiff = '+line\n'.repeat(180_000)

test('GitHub App 适配器读取提交、PR、变更文件与差异并标记截断', async () => {
  const calls: Array<{ route: string; params?: Record<string, unknown> }> = []
  const client: GitHubAppClient = {
    async request(route, params) {
      calls.push({ route, params })
      if (route === 'GET /repos/{owner}/{repo}/commits') return { data: [githubCommit] }
      if (route === 'GET /repos/{owner}/{repo}/commits/{ref}') return { data: githubCommit }
      if (route === 'GET /repos/{owner}/{repo}/pulls') return { data: [githubPullRequest, githubPullRequestOther] }
      if (route === 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews') return { data: githubReviews }
      if (route === 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files') return { data: githubFiles }
      if (route === 'GET /repos/{owner}/{repo}/pulls/{pull_number}') {
        const headers = params?.headers
        const accept =
          typeof headers === 'object' && headers !== null && 'accept' in headers && typeof headers.accept === 'string'
            ? headers.accept
            : ''
        return { data: accept.includes('diff') ? oversizedDiff : githubPullRequest }
      }
      throw Object.assign(new Error('unexpected route'), { status: 500 })
    },
  }
  const adapter = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    allowedRepositories: readAllowed,
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client,
  })
  assert.ok(hasReadMethods(adapter))

  const commits = await adapter.listCommits({ repository: readRepository, ref: 'main', page: 2, pageSize: 20 })
  assert.deepEqual(commits, [
    {
      sha: githubCommit.sha,
      title: 'feat: 登录',
      authorName: 'Alice',
      committedAt: '2026-11-09T10:00:00Z',
      url: githubCommit.html_url,
    },
  ])
  const commitListParams = calls.find((call) => call.route === 'GET /repos/{owner}/{repo}/commits')?.params
  assert.equal(commitListParams?.per_page, 20)
  assert.equal(commitListParams?.page, 2)
  assert.equal(commitListParams?.sha, 'main')
  const commitDetail = await adapter.getCommit({ repository: readRepository, ref: githubCommit.sha })
  assert.equal(commitDetail.title, 'feat: 登录')
  assert.deepEqual(commitDetail.files, [
    { path: 'src/login.ts', status: 'modified', additions: 10, deletions: 2 },
    { path: 'logo.png', status: 'added', additions: 0, deletions: 0 },
  ])
  assert.equal(commitDetail.filesTruncated, false)
  assert.equal(commitDetail.filesUnsupported, false)

  const pullRequests = await adapter.listPullRequests({
    repository: readRepository,
    state: 'closed',
    page: 1,
    pageSize: 20,
  })
  assert.equal(pullRequests.length, 2)
  assert.equal(pullRequests[0]?.state, 'merged')
  assert.equal(pullRequests[0]?.reviewStatus, 'unknown')
  assert.equal(pullRequests[0]?.sourceBranch, 'feat/login')
  assert.equal(pullRequests[0]?.targetBranch, 'main')
  const pullListParams = calls.find((call) => call.route === 'GET /repos/{owner}/{repo}/pulls')?.params
  assert.equal(pullListParams?.state, 'closed')
  // 作者过滤在读取页内完成，未知作者返回空列表而不是失败。
  const bobPullRequests = await adapter.listPullRequests({
    repository: readRepository,
    author: 'bob',
    page: 1,
    pageSize: 20,
  })
  assert.equal(bobPullRequests.length, 1)
  assert.equal(bobPullRequests[0]?.number, 9)
  assert.deepEqual(
    await adapter.listPullRequests({ repository: readRepository, author: 'nobody', page: 1, pageSize: 20 }),
    [],
  )

  const pullRequest = await adapter.getPullRequest({ repository: readRepository, number: 8 })
  assert.equal(pullRequest.number, 8)
  assert.equal(pullRequest.state, 'merged')
  assert.equal(pullRequest.reviewStatus, 'changes_requested')
  assert.equal(pullRequest.files.length, 3)
  assert.equal(pullRequest.files[0]?.path, 'src/login.ts')
  assert.equal(pullRequest.files[0]?.patch, '@@ -1 +1 @@\n-old\n+new')
  assert.equal(pullRequest.files[1]?.binary, true)
  assert.equal(pullRequest.files[2]?.truncated, true)
  assert.ok((pullRequest.files[2]?.patch ?? '').length <= 100 * 1024)
  assert.equal(pullRequest.truncated, true)

  const diff = await adapter.getPullRequestDiff({ repository: readRepository, number: 8 })
  assert.equal(diff.truncated, true)
  assert.ok(diff.patch.length > 0)
  assert.ok(Buffer.byteLength(diff.patch, 'utf8') <= 1024 * 1024)

  // 单页数量按契约上限收窄，避免调用方放大来源请求。
  await adapter.listCommits({ repository: readRepository, page: 1, pageSize: 500 })
  const clampedParams = calls.filter((call) => call.route === 'GET /repos/{owner}/{repo}/commits').at(-1)?.params
  assert.equal(clampedParams?.per_page, 100)

  await assert.rejects(
    adapter.listCommits({ repository: { namespace: 'evil', name: 'repo' }, page: 1, pageSize: 20 }),
    rejectsWithCode('unsupported'),
  )
  await assert.rejects(
    adapter.getPullRequestDiff({ repository: { namespace: 'evil', name: 'repo' }, number: 8 }),
    rejectsWithCode('unsupported'),
  )
})

test('GitHub App 读取错误映射：授权、限流、不存在、超时与非法响应', async () => {
  function adapterWithError(createError: () => unknown) {
    return createGitHubAppAdapter({
      ...baseInput,
      authKind: 'github_app_installation',
      allowedRepositories: readAllowed,
      appId: '1',
      privateKey: 'key',
      installationId: 2,
      client: {
        async request() {
          throw createError()
        },
      },
    })
  }
  const unauthorized = adapterWithError(() => Object.assign(new Error('unauthorized'), { status: 401 }))
  assert.ok(hasReadMethods(unauthorized))
  await assert.rejects(
    unauthorized.listCommits({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('auth_failed'),
  )
  const rateLimited = adapterWithError(() => Object.assign(new Error('API rate limit exceeded'), { status: 403 }))
  assert.ok(hasReadMethods(rateLimited))
  await assert.rejects(
    rateLimited.listPullRequests({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('unavailable'),
  )
  const notFound = adapterWithError(() => Object.assign(new Error('missing'), { status: 404 }))
  assert.ok(hasReadMethods(notFound))
  await assert.rejects(notFound.getPullRequest({ repository: readRepository, number: 9 }), rejectsWithCode('not_found'))
  const timedOut = adapterWithError(() => Object.assign(new Error('gateway'), { status: 504 }))
  assert.ok(hasReadMethods(timedOut))
  await assert.rejects(timedOut.getCommit({ repository: readRepository, ref: 'main' }), rejectsWithCode('timeout'))
  const unavailable = adapterWithError(() => Object.assign(new Error('server'), { status: 500 }))
  assert.ok(hasReadMethods(unavailable))
  await assert.rejects(
    unavailable.listCommits({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('unavailable'),
  )

  const malformed = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    allowedRepositories: readAllowed,
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client: {
      async request() {
        return { data: { items: [] } }
      },
    },
  })
  assert.ok(hasReadMethods(malformed))
  await assert.rejects(
    malformed.listPullRequests({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('invalid_response'),
  )
  await assert.rejects(
    malformed.getPullRequestDiff({ repository: readRepository, number: 8 }),
    rejectsWithCode('invalid_response'),
  )
})

test('GitHub CLI 适配器读取提交、PR、变更文件与差异并映射失败', async () => {
  const calls: string[][] = []
  const adapter = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: readAllowed,
    exec: async (args) => {
      calls.push(args)
      const joined = args.join(' ')
      if (joined.startsWith('api repos/acme/app/commits?'))
        return { stdout: JSON.stringify([githubCommit]), stderr: '' }
      if (joined.startsWith('api repos/acme/app/commits/')) return { stdout: JSON.stringify(githubCommit), stderr: '' }
      if (joined.startsWith('api repos/acme/app/pulls?'))
        return { stdout: JSON.stringify([githubPullRequest, githubPullRequestOther]), stderr: '' }
      if (joined.includes('/reviews?')) return { stdout: JSON.stringify(githubReviews), stderr: '' }
      if (joined.includes('/files?')) return { stdout: JSON.stringify(githubFiles), stderr: '' }
      if (joined.includes('--header Accept: application/vnd.github.v3.diff'))
        return { stdout: oversizedDiff, stderr: '' }
      if (joined === 'api repos/acme/app/pulls/8') return { stdout: JSON.stringify(githubPullRequest), stderr: '' }
      throw new Error(`unexpected gh args: ${joined}`)
    },
  })
  assert.ok(hasReadMethods(adapter))

  const commits = await adapter.listCommits({ repository: readRepository, ref: 'main', page: 2, pageSize: 20 })
  assert.equal(commits[0]?.sha, githubCommit.sha)
  const commitListArgs = calls.find((args) => args.join(' ').startsWith('api repos/acme/app/commits?'))
  assert.ok(commitListArgs?.some((arg) => arg.includes('per_page=20')))
  assert.ok(commitListArgs?.some((arg) => arg.includes('page=2')))
  assert.ok(commitListArgs?.some((arg) => arg.includes('sha=main')))
  assert.equal((await adapter.getCommit({ repository: readRepository, ref: 'main' })).title, 'feat: 登录')

  const pullRequests = await adapter.listPullRequests({
    repository: readRepository,
    state: 'all',
    page: 1,
    pageSize: 20,
  })
  assert.equal(pullRequests[0]?.state, 'merged')
  const pullListArgs = calls.find((args) => args.join(' ').startsWith('api repos/acme/app/pulls?'))
  assert.ok(pullListArgs?.some((arg) => arg.includes('state=all')))

  const pullRequest = await adapter.getPullRequest({ repository: readRepository, number: 8 })
  assert.equal(pullRequest.reviewStatus, 'changes_requested')
  assert.equal(pullRequest.files[2]?.truncated, true)
  const diff = await adapter.getPullRequestDiff({ repository: readRepository, number: 8 })
  assert.equal(diff.truncated, true)
  assert.ok(calls.some((args) => args.some((arg) => arg === '--header')))
  assert.ok(calls.every((args) => !args.some((arg) => arg.includes('--method'))))

  const failing = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: readAllowed,
    exec: async () => {
      throw Object.assign(new Error('HTTP 401'), { stderr: 'HTTP 401: Bad credentials' })
    },
  })
  assert.ok(hasReadMethods(failing))
  await assert.rejects(
    failing.listCommits({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('auth_failed'),
  )

  const notFound = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: readAllowed,
    exec: async () => {
      throw Object.assign(new Error('HTTP 404'), { stderr: 'HTTP 404: Not Found' })
    },
  })
  assert.ok(hasReadMethods(notFound))
  await assert.rejects(notFound.getCommit({ repository: readRepository, ref: 'main' }), rejectsWithCode('not_found'))

  const timedOut = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: readAllowed,
    exec: async () => {
      throw Object.assign(new Error('timeout'), { killed: true })
    },
  })
  assert.ok(hasReadMethods(timedOut))
  await assert.rejects(
    timedOut.listPullRequests({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('timeout'),
  )

  const unavailable = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: readAllowed,
    exec: async () => {
      throw Object.assign(new Error('HTTP 500'), { stderr: 'HTTP 500: Internal Server Error' })
    },
  })
  assert.ok(hasReadMethods(unavailable))
  await assert.rejects(
    unavailable.getPullRequest({ repository: readRepository, number: 8 }),
    rejectsWithCode('unavailable'),
  )
})

test('PR 变更文件达到 100 个上限时保留前 100 个并标记截断', async () => {
  const manyFiles = Array.from({ length: 101 }, (_, index) => ({
    filename: `file-${index}.txt`,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: '@@ -1 +1 @@',
  }))
  const client: GitHubAppClient = {
    async request(route) {
      if (route.endsWith('/reviews')) return { data: [] }
      if (route.endsWith('/files')) return { data: manyFiles }
      return { data: githubPullRequest }
    },
  }
  const adapter = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    allowedRepositories: readAllowed,
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client,
  })
  assert.ok(hasReadMethods(adapter))
  const detail = await adapter.getPullRequest({ repository: readRepository, number: 8 })
  assert.equal(detail.files.length, 100)
  assert.equal(detail.files[0]?.path, 'file-0.txt')
  assert.equal(detail.truncated, true)
})

const giteaCommit = {
  sha: 'abcdef1234567890',
  html_url: 'https://gitea.example.test/acme/app/commit/abcdef1234567890',
  commit: {
    message: 'fix: 登录失败\n\n说明',
    author: { name: 'Bob', date: '2026-11-09T10:00:00+08:00' },
  },
  files: [
    { filename: 'src/login.ts', status: 'modified', additions: 5, deletions: 1 },
    { filename: 'bin/app.bin', additions: 0, deletions: 0 },
  ],
}
const giteaPullRequest = {
  number: 8,
  title: 'feat: 登录',
  state: 'open',
  merged: false,
  merged_at: null,
  user: { login: 'alice' },
  head: { ref: 'feat/login' },
  base: { ref: 'main' },
  created_at: '2026-11-08T10:00:00Z',
  updated_at: '2026-11-09T10:00:00Z',
  html_url: 'https://gitea.example.test/acme/app/pulls/8',
}
const giteaPullRequestOther = {
  number: 9,
  title: 'fix: 登出',
  state: 'open',
  merged: false,
  merged_at: null,
  user: { login: 'bob' },
  head: { ref: 'fix/logout' },
  base: { ref: 'main' },
  created_at: '2026-11-07T10:00:00Z',
  updated_at: '2026-11-08T10:00:00Z',
  html_url: 'https://gitea.example.test/acme/app/pulls/9',
}
const giteaFiles = [
  { filename: 'src/login.ts', status: 'modified', additions: 5, deletions: 1, patch: '@@ -1 +1 @@' },
  { filename: 'bin/app.bin', additions: 0, deletions: 0 },
  { filename: 'docs/big.md', status: 'modified', additions: 1, deletions: 1, patch: oversizedPatch },
]
const giteaReview = {
  id: 1,
  user: { login: 'bob' },
  state: 'APPROVED',
  submitted_at: '2026-11-09T09:00:00Z',
}

test('Gitea 适配器读取提交、PR、变更文件与差异并按能力降级', async () => {
  const urls: string[] = []
  const adapter = createGiteaAdapter({
    provider: 'gitea',
    authKind: 'gitea_token',
    instanceUrl: 'https://gitea.example.test',
    token: 'token',
    fetch: async (url) => {
      urls.push(url)
      if (url.includes('/git/commits/')) return jsonResponse(giteaCommit)
      if (url.includes('/commits?')) return jsonResponse([giteaCommit])
      if (url.includes('/pulls?')) return jsonResponse([giteaPullRequest, giteaPullRequestOther])
      if (url.includes('/reviews?')) return jsonResponse([giteaReview])
      if (url.includes('/files?')) return jsonResponse(giteaFiles)
      if (url.endsWith('.diff')) return new Response(oversizedDiff, { status: 200 })
      if (/\/pulls\/\d+$/.test(url)) return jsonResponse(giteaPullRequest)
      return jsonResponse({ message: 'not found' }, 404)
    },
  })
  assert.ok(hasReadMethods(adapter))

  const commits = await adapter.listCommits({ repository: readRepository, ref: 'main', page: 2, pageSize: 20 })
  assert.deepEqual(commits, [
    {
      sha: giteaCommit.sha,
      title: 'fix: 登录失败',
      authorName: 'Bob',
      committedAt: '2026-11-09T10:00:00+08:00',
      url: giteaCommit.html_url,
    },
  ])
  assert.ok(urls.some((url) => url.includes('/commits?page=2&limit=20&sha=main')))
  const commitDetail = await adapter.getCommit({ repository: readRepository, ref: 'main' })
  assert.equal(commitDetail.title, 'fix: 登录失败')
  assert.equal(commitDetail.files.length, 2)
  assert.equal(commitDetail.filesTruncated, false)
  assert.equal(commitDetail.filesUnsupported, false)

  const pullRequests = await adapter.listPullRequests({ repository: readRepository, page: 1, pageSize: 20 })
  assert.equal(pullRequests.length, 2)
  assert.equal(pullRequests[0]?.state, 'open')
  assert.equal(pullRequests[0]?.reviewStatus, 'unknown')
  assert.ok(urls.some((url) => url.includes('/pulls?state=open&page=1&limit=20')))
  const bobPullRequests = await adapter.listPullRequests({
    repository: readRepository,
    author: 'bob',
    page: 1,
    pageSize: 20,
  })
  assert.equal(bobPullRequests.length, 1)
  assert.equal(bobPullRequests[0]?.number, 9)

  const pullRequest = await adapter.getPullRequest({ repository: readRepository, number: 8 })
  assert.equal(pullRequest.reviewStatus, 'approved')
  assert.equal(pullRequest.files.length, 3)
  assert.equal(pullRequest.files[1]?.binary, true)
  assert.equal(pullRequest.files[2]?.truncated, true)
  assert.equal(pullRequest.truncated, true)
  const diff = await adapter.getPullRequestDiff({ repository: readRepository, number: 8 })
  assert.equal(diff.truncated, true)
  assert.ok(Buffer.byteLength(diff.patch, 'utf8') <= 1024 * 1024)
  assert.ok(urls.some((url) => url.endsWith('/pulls/8.diff')))

  // 旧版 Gitea 缺少 PR 变更文件接口时降级为 unsupported，而不是返回空文件列表。
  const withoutFiles = createGiteaAdapter({
    provider: 'gitea',
    authKind: 'gitea_token',
    instanceUrl: 'https://gitea.example.test',
    token: 'token',
    fetch: async (url) => {
      if (url.includes('/pulls?')) return jsonResponse([giteaPullRequest, giteaPullRequestOther])
      if (url.includes('/reviews?')) return jsonResponse([])
      if (url.includes('/files?')) return jsonResponse({ message: 'not found' }, 404)
      return jsonResponse(giteaPullRequest)
    },
  })
  assert.ok(hasReadMethods(withoutFiles))
  await assert.rejects(
    withoutFiles.getPullRequest({ repository: readRepository, number: 8 }),
    rejectsWithCode('unsupported'),
  )

  // 缺少评审接口时评审状态为 unknown，PR 基本信息仍可读取。
  const withoutReviews = createGiteaAdapter({
    provider: 'gitea',
    authKind: 'gitea_token',
    instanceUrl: 'https://gitea.example.test',
    token: 'token',
    fetch: async (url) => {
      if (url.includes('/reviews?')) return jsonResponse({ message: 'not found' }, 404)
      if (url.includes('/files?')) return jsonResponse(giteaFiles)
      return jsonResponse(giteaPullRequest)
    },
  })
  assert.ok(hasReadMethods(withoutReviews))
  const degraded = await withoutReviews.getPullRequest({ repository: readRepository, number: 8 })
  assert.equal(degraded.reviewStatus, 'unknown')
  assert.equal(degraded.files.length, 3)
})

test('Gitea 读取错误映射：授权、不存在、限流、超时与非法响应', async () => {
  function adapterWithFetch(fetchImpl: GiteaFetch) {
    return createGiteaAdapter({
      provider: 'gitea',
      authKind: 'gitea_token',
      instanceUrl: 'https://gitea.example.test',
      token: 'token',
      fetch: fetchImpl,
    })
  }
  const authFailed = adapterWithFetch(async () => jsonResponse({ message: 'unauthorized' }, 401))
  assert.ok(hasReadMethods(authFailed))
  await assert.rejects(
    authFailed.listCommits({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('auth_failed'),
  )

  const notFound = adapterWithFetch(async () => jsonResponse({ message: 'not found' }, 404))
  assert.ok(hasReadMethods(notFound))
  await assert.rejects(notFound.getCommit({ repository: readRepository, ref: 'main' }), rejectsWithCode('not_found'))

  const rateLimited = adapterWithFetch(async () => jsonResponse({ message: 'too many' }, 429))
  assert.ok(hasReadMethods(rateLimited))
  await assert.rejects(
    rateLimited.listPullRequests({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('unavailable'),
  )

  const timedOut = adapterWithFetch(async () => {
    throw Object.assign(new Error('timeout'), { name: 'TimeoutError' })
  })
  assert.ok(hasReadMethods(timedOut))
  await assert.rejects(timedOut.getPullRequest({ repository: readRepository, number: 8 }), rejectsWithCode('timeout'))

  const malformed = adapterWithFetch(async () => new Response('not-json', { status: 200 }))
  assert.ok(hasReadMethods(malformed))
  await assert.rejects(
    malformed.listCommits({ repository: readRepository, page: 1, pageSize: 20 }),
    rejectsWithCode('invalid_response'),
  )
})

test('提交详情来源缺少 files 时标记不支持，超过上限时标记截断', async () => {
  const commitWithoutFiles = { ...githubCommit, files: undefined }
  const appAdapter = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    allowedRepositories: readAllowed,
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client: {
      async request(route) {
        if (route === 'GET /repos/{owner}/{repo}/commits/{ref}') return { data: commitWithoutFiles }
        throw Object.assign(new Error('unexpected route'), { status: 500 })
      },
    },
  })
  assert.ok(hasReadMethods(appAdapter))
  const unsupportedDetail = await appAdapter.getCommit({ repository: readRepository, ref: 'main' })
  assert.deepEqual(unsupportedDetail.files, [])
  assert.equal(unsupportedDetail.filesUnsupported, true)
  assert.equal(unsupportedDetail.filesTruncated, false)

  const cliAdapter = createGitHubCliAdapter({
    ...baseInput,
    allowedRepositories: readAllowed,
    exec: async (args) => {
      const joined = args.join(' ')
      if (joined.startsWith('api repos/acme/app/commits/'))
        return { stdout: JSON.stringify(commitWithoutFiles), stderr: '' }
      throw new Error(`unexpected gh args: ${joined}`)
    },
  })
  assert.ok(hasReadMethods(cliAdapter))
  const cliDetail = await cliAdapter.getCommit({ repository: readRepository, ref: 'main' })
  assert.equal(cliDetail.filesUnsupported, true)

  const giteaAdapter = createGiteaAdapter({
    provider: 'gitea',
    authKind: 'gitea_token',
    instanceUrl: 'https://gitea.example.test',
    token: 'token',
    fetch: async (url) => {
      if (url.includes('/git/commits/')) return jsonResponse(commitWithoutFiles)
      return jsonResponse({ message: 'not found' }, 404)
    },
  })
  assert.ok(hasReadMethods(giteaAdapter))
  const giteaDetail = await giteaAdapter.getCommit({ repository: readRepository, ref: 'main' })
  assert.equal(giteaDetail.filesUnsupported, true)

  const manyFiles = Array.from({ length: 101 }, (_, index) => ({
    filename: `file-${index}.txt`,
    status: 'modified',
    additions: 1,
    deletions: 0,
  }))
  const truncatingAdapter = createGitHubAppAdapter({
    ...baseInput,
    authKind: 'github_app_installation',
    allowedRepositories: readAllowed,
    appId: '1',
    privateKey: 'key',
    installationId: 2,
    client: {
      async request() {
        return { data: { ...githubCommit, files: manyFiles } }
      },
    },
  })
  assert.ok(hasReadMethods(truncatingAdapter))
  const truncatedDetail = await truncatingAdapter.getCommit({ repository: readRepository, ref: 'main' })
  assert.equal(truncatedDetail.files.length, 100)
  assert.equal(truncatedDetail.filesTruncated, true)
})
