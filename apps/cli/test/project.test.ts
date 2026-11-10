import assert from 'node:assert/strict'
import type { IncomingHttpHeaders } from 'node:http'
import { Command, CommanderError } from 'commander'
import { test, type TestContext } from 'node:test'
import { registerProjectCommands } from '../src/commands/project.ts'
import type { CliContext } from '../src/lib/context.ts'
import { CliError, reportError } from '../src/lib/errors.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const TOKEN = 'devops_pat_project_test_0000000000000'

interface ExecutionResult {
  code: number
  stdout: string
  stderr: string
}

interface CapturedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

interface RecordedServer {
  url: string
  requests: CapturedRequest[]
}

/** 测试用根命令：与 cli.ts 的全局选项保持一致，仅注册 project 域。 */
function createProgram(context: CliContext): Command {
  const program = new Command()
  program
    .name('devops')
    .version('0.0.0')
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
    .configureOutput({ writeOut: (message) => context.stdout(message), writeErr: () => undefined })
  registerProjectCommands(program, context)
  return program
}

/** 复现 runCli 的退出码映射，避免测试依赖尚未注册全部命令域的 cli.ts。 */
async function execute(args: string[], env: NodeJS.ProcessEnv = {}): Promise<ExecutionResult> {
  let stdout = ''
  let stderr = ''
  const context: CliContext = {
    version: '0.0.0',
    env: { DEV_OPS_TOKEN: TOKEN, ...env },
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
  }
  const program = createProgram(context)
  try {
    await program.parseAsync(args, { from: 'user' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.version', 'commander.help'].includes(error.code)) {
        return { code: 0, stdout, stderr }
      }
      const message = error.message.replace(/^error:\s*/i, '').trim() || '参数无法识别，请运行 devops --help'
      return {
        code: reportError(new CliError(message, 2, { code: 'INVALID_ARGUMENTS' }), {
          json: false,
          stderr: context.stderr,
        }),
        stdout,
        stderr,
      }
    }
    return {
      code: reportError(error, { json: args.includes('--json'), stderr: context.stderr }),
      stdout,
      stderr,
    }
  }
}

/** 启动会记录请求的本地 HTTP 桩服务。 */
async function startRecordingServer(
  t: TestContext,
  respond: (request: CapturedRequest) => { data?: unknown; failure?: { code: string; message: string } },
): Promise<RecordedServer> {
  const requests: CapturedRequest[] = []
  const url = await startStubServer(t, (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const captured: CapturedRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body,
      }
      requests.push(captured)
      const reply = respond(captured)
      response.setHeader('content-type', 'application/json')
      response.end(
        reply.failure ? failureEnvelope(reply.failure.code, reply.failure.message) : successEnvelope(reply.data),
      )
    })
  })
  return { url, requests }
}

/** 读取并校验 stdout 成功信封中的数据。 */
function successData(text: string): unknown {
  const payload: unknown = JSON.parse(text)
  if (typeof payload !== 'object' || payload === null || !('success' in payload) || payload.success !== true) {
    throw new Error('stdout 不是成功信封')
  }
  if (!('data' in payload)) throw new Error('stdout 成功信封缺少 data')
  return payload.data
}

/** 读取并校验 stderr 错误信封。 */
function errorPayload(text: string): { code: string; message: string } {
  const payload: unknown = JSON.parse(text)
  if (typeof payload !== 'object' || payload === null || !('code' in payload) || typeof payload.code !== 'string') {
    throw new Error('stderr 不是错误信封')
  }
  const message = 'message' in payload && typeof payload.message === 'string' ? payload.message : ''
  return { code: payload.code, message }
}

/** 取指定下标的请求；缺失时失败而不是静默跳过。 */
function requestAt(requests: CapturedRequest[], index: number): CapturedRequest {
  const request = requests[index]
  if (request === undefined) throw new Error(`未收到第 ${index + 1} 个请求`)
  return request
}

function projectRow(id: string, options: { version?: number } = {}) {
  return {
    id,
    teamId: 'team-1',
    name: `项目 ${id}`,
    description: null,
    owner: { userId: 'user-1', name: '测试用户' },
    status: 'active',
    counts: { openRequirements: 0, openBugs: 0 },
    version: options.version ?? 1,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
  }
}

function repositoryRow(id: string) {
  return {
    id,
    connectionId: 'conn-1',
    providerKey: 'gitea',
    namespace: 'devops',
    name: `repo-${id}`,
    webUrl: `https://gitea.example.test/devops/repo-${id}`,
    defaultBranch: 'main',
    status: 'active',
  }
}

test('project list 发送筛选分页参数并归一化 JSON 列表', async (t) => {
  const row = projectRow('p1')
  const { url, requests } = await startRecordingServer(t, () => ({
    data: { items: [row], page: 2, pageSize: 10, total: 12 },
  }))
  const result = await execute([
    'project',
    'list',
    '--team',
    'team-1',
    '--search',
    'cli',
    '--status',
    'active',
    '--page',
    '2',
    '--page-size',
    '10',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'GET')
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`)
  const requestUrl = new URL(request.url, url)
  assert.equal(requestUrl.pathname, '/api/v1/teams/team-1/projects')
  assert.equal(requestUrl.searchParams.get('search'), 'cli')
  assert.equal(requestUrl.searchParams.get('status'), 'active')
  assert.equal(requestUrl.searchParams.get('page'), '2')
  assert.equal(requestUrl.searchParams.get('pageSize'), '10')
  assert.deepEqual(successData(result.stdout), { items: [row], page: 2, pageSize: 10, total: 12 })
})

test('project list --all 逐页读取并合并，不静默截断', async (t) => {
  const pages: Record<string, unknown> = {
    '1': { items: [projectRow('p1'), projectRow('p2')], page: 1, pageSize: 2, total: 3 },
    '2': { items: [projectRow('p3')], page: 2, pageSize: 2, total: 3 },
  }
  const { url, requests } = await startRecordingServer(t, (request) => {
    const page = new URL(request.url, 'http://127.0.0.1').searchParams.get('page') ?? '1'
    return { data: pages[page] ?? { items: [], page: 1, pageSize: 2, total: 3 } }
  })
  const result = await execute(['project', 'list', '--team', 'team-1', '--all', '--server', url, '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(new URL(requestAt(requests, 0).url, url).searchParams.get('page'), '1')
  assert.equal(new URL(requestAt(requests, 1).url, url).searchParams.get('page'), '2')
  const data = successData(result.stdout)
  assert.deepEqual(data, {
    items: [projectRow('p1'), projectRow('p2'), projectRow('p3')],
    page: 1,
    pageSize: 3,
    total: 3,
  })
})

test('project list 非法状态在请求前按参数错误退出 2', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: {} }))
  const result = await execute(['project', 'list', '--team', 'team-1', '--status', 'done', '--server', url, '--json'])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(errorPayload(result.stderr).code, 'INVALID_STATUS')
  assert.equal(requests.length, 0)
})

test('project create 发送名称、描述、负责人与幂等键', async (t) => {
  const created = projectRow('p-new')
  const { url, requests } = await startRecordingServer(t, () => ({ data: created }))
  const result = await execute([
    'project',
    'create',
    '--team',
    'team-1',
    '--name',
    ' 测试项目 ',
    '--description',
    'CLI 创建',
    '--owner',
    'user-2',
    '--idempotency-key',
    '11111111-1111-1111-1111-111111111111',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/teams/team-1/projects')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(request.headers['idempotency-key'], '11111111-1111-1111-1111-111111111111')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { name: '测试项目', description: 'CLI 创建', ownerUserId: 'user-2' })
  assert.deepEqual(successData(result.stdout), created)
})

test('project create 缺少名称按参数错误退出 2 且不发请求', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: {} }))
  const result = await execute(['project', 'create', '--team', 'team-1', '--server', url, '--json'])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(errorPayload(result.stderr).code, 'MISSING_OPTION')
  assert.equal(requests.length, 0)
})

test('project update 状态缺少原因时退出 2 且不发请求', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: projectRow('p1') }))
  const result = await execute([
    'project',
    'update',
    'p1',
    '--status',
    'paused',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(errorPayload(result.stderr).code, 'MISSING_REASON')
  assert.equal(requests.length, 0)
})

test('project update 使用 --expected-version 发送版本与状态原因', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: projectRow('p1', { version: 4 }) }))
  const result = await execute([
    'project',
    'update',
    'p1',
    '--status',
    'paused',
    '--reason',
    '业务调整',
    '--expected-version',
    '3',
    '--idempotency-key',
    '22222222-2222-2222-2222-222222222222',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 1)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/projects/p1/update')
  assert.equal(request.headers['idempotency-key'], '22222222-2222-2222-2222-222222222222')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { version: 3, status: 'paused', statusReason: '业务调整' })
})

test('project update 未提供 --expected-version 时先读取当前版本', async (t) => {
  const { url, requests } = await startRecordingServer(t, (request) => {
    if (request.method === 'GET') return { data: projectRow('p1', { version: 5 }) }
    return { data: projectRow('p1', { version: 6 }) }
  })
  const result = await execute(['project', 'update', 'p1', '--name', '新名称', '--server', url, '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(requestAt(requests, 0).method, 'GET')
  assert.equal(new URL(requestAt(requests, 0).url, url).pathname, '/api/v1/projects/p1')
  const request = requestAt(requests, 1)
  assert.equal(request.method, 'POST')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { version: 5, name: '新名称' })
})

test('project get 与 stats 输出详情与统计', async (t) => {
  const row = projectRow('p1')
  const { url, requests } = await startRecordingServer(t, (request) =>
    request.url?.endsWith('/stats') ? { data: { openRequirements: 4, openBugs: 2 } } : { data: row },
  )
  const get = await execute(['project', 'get', 'p1', '--server', url, '--json'])
  assert.equal(get.code, 0, get.stderr)
  assert.deepEqual(successData(get.stdout), row)
  const stats = await execute(['project', 'stats', 'p1', '--server', url, '--json'])
  assert.equal(stats.code, 0, stats.stderr)
  assert.deepEqual(successData(stats.stdout), { openRequirements: 4, openBugs: 2 })
  assert.equal(new URL(requestAt(requests, 1).url, url).pathname, '/api/v1/projects/p1/stats')
})

test('project repository list/available 归一化仓库列表', async (t) => {
  const repository = repositoryRow('repo-1')
  const { url, requests } = await startRecordingServer(t, (request) =>
    request.url?.includes('/available')
      ? { data: { items: [repository], page: 1, pageSize: 5, total: 1 } }
      : { data: [repository] },
  )
  const list = await execute(['project', 'repository', 'list', 'p1', '--server', url, '--json'])
  assert.equal(list.code, 0, list.stderr)
  assert.deepEqual(successData(list.stdout), { items: [repository], page: 1, pageSize: 1, total: 1 })
  const available = await execute([
    'project',
    'repository',
    'available',
    'p1',
    '--search',
    'repo',
    '--page-size',
    '5',
    '--server',
    url,
    '--json',
  ])
  assert.equal(available.code, 0, available.stderr)
  const availableUrl = new URL(requestAt(requests, 1).url, url)
  assert.equal(availableUrl.pathname, '/api/v1/projects/p1/repositories/available')
  assert.equal(availableUrl.searchParams.get('search'), 'repo')
  assert.equal(availableUrl.searchParams.get('pageSize'), '5')
  assert.deepEqual(successData(available.stdout), { items: [repository], page: 1, pageSize: 5, total: 1 })
})

test('project repository add 发送仓库标识并生成幂等键', async (t) => {
  const repository = repositoryRow('repo-1')
  const { url, requests } = await startRecordingServer(t, () => ({ data: [repository] }))
  const result = await execute([
    'project',
    'repository',
    'add',
    'p1',
    '--repository',
    'repo-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/projects/p1/repositories')
  assert.match(String(request.headers['idempotency-key']), /^[0-9a-f-]{36}$/)
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { repositoryId: 'repo-1' })
  assert.deepEqual(successData(result.stdout), { items: [repository], page: 1, pageSize: 1, total: 1 })
})

test('project repository remove 缺少 --yes 或原因时退出 2 且不发请求', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: [] }))
  const noYes = await execute([
    'project',
    'repository',
    'remove',
    'p1',
    '--repository',
    'repo-1',
    '--reason',
    '仓库迁移',
    '--server',
    url,
    '--json',
  ])
  assert.equal(noYes.code, 2)
  assert.equal(noYes.stdout, '')
  assert.equal(errorPayload(noYes.stderr).code, 'CONFIRMATION_REQUIRED')
  const noReason = await execute([
    'project',
    'repository',
    'remove',
    'p1',
    '--repository',
    'repo-1',
    '--yes',
    '--server',
    url,
    '--json',
  ])
  assert.equal(noReason.code, 2)
  assert.equal(errorPayload(noReason.stderr).code, 'MISSING_OPTION')
  assert.equal(requests.length, 0)
})

test('project repository remove 提供 --yes 与原因后发送移除请求', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: [] }))
  const result = await execute([
    'project',
    'repository',
    'remove',
    'p1',
    '--repository',
    'repo-1',
    '--reason',
    '仓库迁移',
    '--yes',
    '--idempotency-key',
    '33333333-3333-3333-3333-333333333333',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/projects/p1/repositories/repo-1/remove')
  assert.equal(request.headers['idempotency-key'], '33333333-3333-3333-3333-333333333333')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { reason: '仓库迁移' })
  assert.deepEqual(successData(result.stdout), { items: [], page: 1, pageSize: 0, total: 0 })
})
