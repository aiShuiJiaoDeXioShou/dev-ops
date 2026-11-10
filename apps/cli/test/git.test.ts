import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Command, CommanderError } from 'commander'
import { registerGitCommands } from '../src/commands/git.ts'
import type { CliContext } from '../src/lib/context.ts'
import { reportError } from '../src/lib/errors.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const API_TOKEN = 'devops_pat_test_token_abcdefghijklmnop'
const GIT_TOKEN = 'gitea_secret_token_should_not_leak'
const TEAM_ID = 'team-1'

interface ExecuteOptions {
  input?: string
  env?: NodeJS.ProcessEnv
}

interface ExecutedCommand {
  code: number
  stdout: string
  stderr: string
}

interface CapturedRequest {
  method: string
  path: string
  body: string
}

const previousConfigHome = process.env.XDG_CONFIG_HOME
let configDirectory = ''

test.before(async () => {
  configDirectory = await mkdtemp(join(tmpdir(), 'devops-cli-git-'))
  process.env.XDG_CONFIG_HOME = configDirectory
})

test.after(async () => {
  if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = previousConfigHome
  await rm(configDirectory, { recursive: true, force: true })
})

/** 启动返回成功/失败 JSON 信封的本地桩服务，记录每个请求的方法、路径与请求体。 */
async function startJsonStub(t: TestContext, handler: (request: CapturedRequest) => string) {
  const requests: CapturedRequest[] = []
  const server = await startStubServer(t, (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const captured = { method: request.method ?? '', path: request.url ?? '', body }
      requests.push(captured)
      response.setHeader('content-type', 'application/json')
      response.end(handler(captured))
    })
  })
  return { server, requests }
}

/** 与 cli.ts 一致的全局选项与错误处理，便于直接测试 git 命令域。 */
function createProgram(context: CliContext): Command {
  const program = new Command()
  program
    .name('devops')
    .option('--server <url>')
    .option('--timeout <ms>')
    .option('--json')
    .option('--team <teamId>')
    .option('--yes')
    .option('--token-stdin')
    .option('--idempotency-key <uuid>')
    .option('--page <n>')
    .option('--page-size <n>')
    .option('--all')
    .exitOverride()
    .configureOutput({
      writeOut: (message) => context.stdout(message),
      writeErr: () => undefined,
    })
  registerGitCommands(program, context)
  return program
}

async function execute(args: string[], options: ExecuteOptions = {}): Promise<ExecutedCommand> {
  let stdout = ''
  let stderr = ''
  const context: CliContext = {
    version: 'test',
    env: { DEV_OPS_TOKEN: API_TOKEN, ...options.env },
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => options.input ?? '',
  }
  try {
    await createProgram(context).parseAsync(args, { from: 'user' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (error instanceof CommanderError) {
      const isHelp = ['commander.helpDisplayed', 'commander.version', 'commander.help'].includes(error.code)
      if (isHelp) return { code: 0, stdout, stderr }
      return { code: 2, stdout, stderr: `${stderr}错误：${error.message}\n` }
    }
    const code = reportError(error, {
      json: args.includes('--json'),
      stderr: (message) => {
        stderr += message
      },
    })
    return { code, stdout, stderr }
  }
}

function connectionView(id: string) {
  return {
    id,
    teamId: TEAM_ID,
    providerKey: 'gitea',
    instanceUrl: 'https://git.example.test',
    name: '测试连接',
    status: 'active',
    authKind: 'gitea_token',
    externalIdentity: null,
    lastCheckedAt: null,
    lastErrorCode: null,
    repositoryScopeSyncedAt: null,
    createdAt: '2026-11-10T00:00:00.000Z',
  }
}

function repositoryView(id: string) {
  return {
    id,
    connectionId: 'conn-1',
    providerKey: 'gitea',
    namespace: 'dev-ops',
    name: `repo-${id}`,
    webUrl: `https://git.example.test/dev-ops/${id}`,
    defaultBranch: 'main',
    status: 'active',
  }
}

test('git provider list 与 connection list 归一化为列表且使用团队上下文', async (t) => {
  const { server, requests } = await startJsonStub(t, (request) => {
    if (request.path === '/api/v1/git-providers') {
      return successEnvelope([{ providerKey: 'github', name: 'GitHub', authModes: ['github_app'] }])
    }
    if (request.path === `/api/v1/teams/${TEAM_ID}/git-connections`) {
      return successEnvelope([connectionView('conn-1')])
    }
    return failureEnvelope('NOT_FOUND', '未预期的请求')
  })

  const providers = await execute(['git', 'provider', 'list', '--server', server, '--json'])
  assert.equal(providers.code, 0, providers.stderr)
  const providerPayload = JSON.parse(providers.stdout)
  assert.equal(providerPayload.success, true)
  assert.deepEqual(providerPayload.data.items, [{ providerKey: 'github', name: 'GitHub', authModes: ['github_app'] }])
  assert.equal(providerPayload.data.total, 1)

  const connections = await execute(['git', 'connection', 'list', '--server', server, '--team', TEAM_ID, '--json'])
  assert.equal(connections.code, 0, connections.stderr)
  const connectionPayload = JSON.parse(connections.stdout)
  assert.equal(connectionPayload.data.items.length, 1)
  assert.equal(connectionPayload.data.items[0].id, 'conn-1')
  assert.equal(requests.length, 2)
})

test('git connection create 从环境变量或标准输入读取 Gitea Token 且不回显', async (t) => {
  const { server, requests } = await startJsonStub(t, () => successEnvelope(connectionView('conn-gitea')))
  const baseArgs = [
    'git',
    'connection',
    'create',
    '--provider',
    'gitea',
    '--name',
    '自建 Gitea',
    '--instance-url',
    'https://git.example.test/',
    '--team',
    TEAM_ID,
    '--server',
    server,
    '--json',
  ]

  const fromEnv = await execute(baseArgs, { env: { DEV_OPS_GIT_TOKEN: GIT_TOKEN } })
  assert.equal(fromEnv.code, 0, fromEnv.stderr)
  assert.equal(fromEnv.stdout.includes(GIT_TOKEN), false)
  assert.equal(fromEnv.stderr.includes(GIT_TOKEN), false)
  const envRequest = requests[0]
  assert.ok(envRequest)
  assert.deepEqual(JSON.parse(envRequest.body), {
    providerKey: 'gitea',
    name: '自建 Gitea',
    instanceUrl: 'https://git.example.test',
    token: GIT_TOKEN,
  })
  assert.equal(JSON.parse(fromEnv.stdout).data.id, 'conn-gitea')

  const fromStdin = await execute(baseArgs, { input: `${GIT_TOKEN}\n` })
  assert.equal(fromStdin.code, 0, fromStdin.stderr)
  assert.equal(fromStdin.stdout.includes(GIT_TOKEN), false)
  const stdinRequest = requests[1]
  assert.ok(stdinRequest)
  assert.equal(JSON.parse(stdinRequest.body).token, GIT_TOKEN)
})

test('git connection create 对 GitHub 只输出浏览器授权地址', async (t) => {
  const authorizationUrl = 'https://github.com/apps/dev-ops/installations/new?state=state-1'
  const { server, requests } = await startJsonStub(t, () =>
    successEnvelope({ authorizationUrl, expiresAt: '2026-11-10T01:00:00.000Z' }),
  )

  const result = await execute(
    [
      'git',
      'connection',
      'create',
      '--provider',
      'github',
      '--name',
      'GitHub 安装',
      '--team',
      TEAM_ID,
      '--server',
      server,
      '--json',
    ],
    { input: GIT_TOKEN },
  )
  assert.equal(result.code, 0, result.stderr)
  const request = requests[0]
  assert.ok(request)
  assert.deepEqual(JSON.parse(request.body), { providerKey: 'github', name: 'GitHub 安装' })
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.data.authorizationUrl, authorizationUrl)
  assert.equal(result.stdout.includes(GIT_TOKEN), false)
})

test('git connection create 缺少 Gitea Token 时退出 2 且不发送请求', async (t) => {
  const { server, requests } = await startJsonStub(t, () => successEnvelope(connectionView('conn-gitea')))
  const result = await execute([
    'git',
    'connection',
    'create',
    '--provider',
    'gitea',
    '--name',
    '自建 Gitea',
    '--instance-url',
    'https://git.example.test',
    '--team',
    TEAM_ID,
    '--server',
    server,
  ])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.includes('DEV_OPS_GIT_TOKEN'), true)
  assert.equal(requests.length, 0)
})

test('git connection revoke 无 --yes 退出 2 且不发请求，带 --yes 才发送原因', async (t) => {
  const { server, requests } = await startJsonStub(t, () => successEnvelope(connectionView('conn-1')))
  const args = ['git', 'connection', 'revoke', 'conn-1', '--reason', '凭据泄露', '--team', TEAM_ID, '--server', server]

  const rejected = await execute(args)
  assert.equal(rejected.code, 2)
  assert.equal(rejected.stdout, '')
  assert.equal(rejected.stderr.includes('--yes'), true)
  assert.equal(requests.length, 0)

  const accepted = await execute([...args, '--yes', '--json'])
  assert.equal(accepted.code, 0, accepted.stderr)
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.ok(request)
  assert.equal(request.method, 'POST')
  assert.equal(request.path, '/api/v1/git-connections/conn-1/revoke')
  assert.deepEqual(JSON.parse(request.body), { reason: '凭据泄露' })
})

test('git connection check/sync 与 repository list 按契约发送请求', async (t) => {
  const repositoryPage = { items: [repositoryView('repo-1')], page: 2, pageSize: 50, total: 51 }
  const { server, requests } = await startJsonStub(t, (request) => {
    if (request.path === '/api/v1/git-connections/conn-1/check') {
      return successEnvelope({
        status: 'active',
        checkedAt: '2026-11-10T00:00:00.000Z',
        connection: connectionView('conn-1'),
      })
    }
    if (request.path === '/api/v1/git-connections/conn-1/sync-repositories') {
      return successEnvelope({ synced: 2, total: 2, checkedAt: '2026-11-10T00:00:00.000Z' })
    }
    if (request.path.startsWith('/api/v1/git-connections/conn-1/repositories')) {
      return successEnvelope(repositoryPage)
    }
    return failureEnvelope('NOT_FOUND', '未预期的请求')
  })

  const checked = await execute(['git', 'connection', 'check', 'conn-1', '--server', server, '--json'])
  assert.equal(checked.code, 0, checked.stderr)
  assert.equal(JSON.parse(checked.stdout).data.status, 'active')

  const synced = await execute(['git', 'connection', 'sync', 'conn-1', '--server', server, '--json'])
  assert.equal(synced.code, 0, synced.stderr)
  assert.equal(JSON.parse(synced.stdout).data.synced, 2)

  const listed = await execute([
    'git',
    'repository',
    'list',
    '--connection',
    'conn-1',
    '--search',
    'dev',
    '--page',
    '2',
    '--page-size',
    '50',
    '--server',
    server,
    '--json',
  ])
  assert.equal(listed.code, 0, listed.stderr)
  const listPayload = JSON.parse(listed.stdout)
  assert.equal(listPayload.data.items.length, 1)
  assert.equal(listPayload.data.total, 51)
  assert.equal(requests.length, 3)
  const listRequest = requests[2]
  assert.ok(listRequest)
  const listUrl = new URL(listRequest.path, 'http://127.0.0.1')
  assert.equal(listUrl.searchParams.get('search'), 'dev')
  assert.equal(listUrl.searchParams.get('page'), '2')
  assert.equal(listUrl.searchParams.get('pageSize'), '50')
})

test('git repository list --all 逐页合并且不截断', async (t) => {
  const firstPage = Array.from({ length: 100 }, (_, index) => repositoryView(`repo-${index}`))
  const { server, requests } = await startJsonStub(t, (request) => {
    const url = new URL(request.path, 'http://127.0.0.1')
    const page = Number(url.searchParams.get('page') ?? '1')
    if (page === 1) {
      return successEnvelope({ items: firstPage, page: 1, pageSize: 100, total: 101 })
    }
    return successEnvelope({ items: [repositoryView('repo-last')], page: 2, pageSize: 100, total: 101 })
  })

  const result = await execute([
    'git',
    'repository',
    'list',
    '--connection',
    'conn-1',
    '--all',
    '--server',
    server,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.data.items.length, 101)
  assert.equal(payload.data.total, 101)
  assert.equal(requests.length, 2)
})

test('git connection list 未指定团队时通过 /me 选择唯一团队', async (t) => {
  const { server, requests } = await startJsonStub(t, (request) => {
    if (request.path === '/api/v1/me') {
      return successEnvelope({
        user: { id: 'user-1', name: '测试用户', email: 'user@example.test' },
        teams: [{ id: TEAM_ID, name: '测试团队', role: 'admin', status: 'active' }],
      })
    }
    if (request.path === `/api/v1/teams/${TEAM_ID}/git-connections`) {
      return successEnvelope([connectionView('conn-1')])
    }
    return failureEnvelope('NOT_FOUND', '未预期的请求')
  })

  const result = await execute(['git', 'connection', 'list', '--server', server, '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).data.items.length, 1)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.path, '/api/v1/me')
  assert.equal(requests[1]?.path, `/api/v1/teams/${TEAM_ID}/git-connections`)
})
