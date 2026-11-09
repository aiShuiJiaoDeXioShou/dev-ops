import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGitHubCliAdapter } from '../src/adapters/git/github-cli.adapter.js'
import { createGitHubAppAdapter, type GitHubAppClient } from '../src/adapters/git/github.adapter.js'
import { createGiteaAdapter } from '../src/adapters/git/gitea.adapter.js'
import { createGitAdapter } from '../src/adapters/git/git.registry.js'
import { GitAdapterError } from '../src/adapters/git/git.types.js'
import { loadConfig } from '../src/platform/config/env.js'

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
