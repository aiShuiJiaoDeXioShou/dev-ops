import assert from 'node:assert/strict'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { Command, CommanderError } from 'commander'
import { test, type TestContext } from 'node:test'
import { registerBugCommands } from '../src/commands/bug.ts'
import type { CliContext } from '../src/lib/context.ts'
import { reportError } from '../src/lib/errors.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const TEST_TOKEN = 'devops_pat_cli_bug_test_token'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const BUG_ID = '11111111-1111-4111-8111-111111111111'
const DUPLICATE_BUG_ID = '55555555-5555-4555-8555-555555555555'
const REQUIREMENT_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

interface ExecuteOptions {
  env?: NodeJS.ProcessEnv
  stdin?: string
}

interface RecordedRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: IncomingHttpHeaders
  body: unknown
}

function createProgram(context: CliContext): Command {
  const program = new Command()
  program
    .name('devops')
    .description('测试用 CLI')
    .version(context.version, '-v, --version', '显示版本')
    .option('--server <url>', '服务基础地址')
    .option('--timeout <ms>', '请求超时毫秒数')
    .option('--json', '输出 JSON')
    .option('--team <teamId>', '团队上下文')
    .option('--yes', '确认危险操作')
    .option('--token-stdin', '从标准输入读取 Token')
    .option('--idempotency-key <uuid>', '覆盖幂等键')
    .option('--page <n>', '列表页码')
    .option('--page-size <n>', '列表页大小')
    .option('--all', '读取全部列表')
    .exitOverride()
    .configureOutput({
      writeOut: (message) => context.stdout(message),
      writeErr: () => undefined,
    })
  registerBugCommands(program, context)
  return program
}

/** 按 CLI 入口相同的规则执行命令，返回退出码与输出，便于断言行为而不依赖网络。 */
async function execute(args: string[], options: ExecuteOptions = {}): Promise<CliResult> {
  let stdout = ''
  let stderr = ''
  const context: CliContext = {
    version: '1.0.0',
    env: options.env ?? {},
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => options.stdin ?? '',
  }
  try {
    await createProgram(context).parseAsync(args, { from: 'user' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.version', 'commander.help'].includes(error.code)) {
        return { code: 0, stdout, stderr }
      }
      return { code: 2, stdout, stderr }
    }
    const code = reportError(error, { json: args.includes('--json'), stderr: context.stderr })
    return { code, stdout, stderr }
  }
}

function envFor(server: string): NodeJS.ProcessEnv {
  return { DEV_OPS_SERVER: server, DEV_OPS_TOKEN: TEST_TOKEN }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** 启动记录请求的本地桩服务；respond 决定返回的业务数据。 */
async function startRecordingServer(
  t: TestContext,
  respond: (request: RecordedRequest) => unknown,
): Promise<{ baseUrl: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = []
  const baseUrl = await startStubServer(t, async (incoming, response) => {
    const text = await readBody(incoming)
    const parsedUrl = new URL(incoming.url ?? '/', 'http://stub.local')
    const recorded: RecordedRequest = {
      method: incoming.method ?? '',
      path: parsedUrl.pathname,
      query: parsedUrl.searchParams,
      headers: incoming.headers,
      body: text.length === 0 ? undefined : JSON.parse(text),
    }
    requests.push(recorded)
    response.setHeader('content-type', 'application/json')
    response.end(successEnvelope(respond(recorded)))
  })
  return { baseUrl, requests }
}

function bugSummary(number: number): Record<string, unknown> {
  return {
    id: BUG_ID,
    projectId: PROJECT_ID,
    number,
    title: `缺陷 ${number}`,
    status: 'in_fix',
    fixOwner: { userId: USER_ID, name: '张三' },
    regressionOwner: null,
    version: 2,
    updatedAt: '2026-11-10T00:00:00.000Z',
  }
}

test('bug list 在 JSON 模式归一化分页并透传筛选与分页参数', async (t) => {
  const item = bugSummary(1)
  const { baseUrl, requests } = await startRecordingServer(t, () => ({
    items: [item],
    page: 2,
    pageSize: 10,
    total: 21,
  }))
  const result = await execute(
    [
      'bug',
      'list',
      '--project',
      PROJECT_ID,
      '--search',
      '登录失败',
      '--status',
      'in_fix',
      '--owner-unavailable',
      '--page',
      '2',
      '--page-size',
      '10',
      '--json',
    ],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    code: 'OK',
    message: 'OK',
    requestId: 'test-request',
    data: { items: [item], page: 2, pageSize: 10, total: 21 },
  })

  const [request] = requests
  assert.ok(request)
  assert.equal(request.method, 'GET')
  assert.equal(request.path, `/api/v1/projects/${PROJECT_ID}/bugs`)
  assert.equal(request.query.get('search'), '登录失败')
  assert.equal(request.query.get('status'), 'in_fix')
  assert.equal(request.query.get('ownerUnavailable'), 'true')
  assert.equal(request.query.get('page'), '2')
  assert.equal(request.query.get('pageSize'), '10')
})

test('bug list --all 逐页读取并汇总，不静默截断', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, (request) => {
    const page = Number(request.query.get('page'))
    return page === 1
      ? { items: [bugSummary(1), bugSummary(2)], page, pageSize: 100, total: 3 }
      : { items: [bugSummary(3)], page, pageSize: 100, total: 3 }
  })
  const result = await execute(['bug', 'list', '--project', PROJECT_ID, '--all', '--json'], { env: envFor(baseUrl) })

  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.query.get('page'), '1')
  assert.equal(requests[0]?.query.get('pageSize'), '100')
  assert.equal(requests[1]?.query.get('page'), '2')
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    code: 'OK',
    message: 'OK',
    requestId: 'test-request',
    data: { items: [bugSummary(1), bugSummary(2), bugSummary(3)], page: 1, pageSize: 3, total: 3 },
  })
})

test('bug list 非法状态在请求前以退出码 2 拒绝', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({}))
  const result = await execute(['bug', 'list', '--project', PROJECT_ID, '--status', 'unknown', '--json'], {
    env: envFor(baseUrl),
  })

  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /INVALID_STATUS/)
  assert.equal(requests.length, 0)
})

test('bug get 输出详情 JSON 信封', async (t) => {
  const detail = { id: BUG_ID, number: 7, status: 'pending' }
  const { baseUrl, requests } = await startRecordingServer(t, () => detail)
  const result = await execute(['bug', 'get', BUG_ID, '--json'], { env: envFor(baseUrl) })

  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    code: 'OK',
    message: 'OK',
    requestId: 'test-request',
    data: detail,
  })
  assert.equal(requests[0]?.path, `/api/v1/bugs/${BUG_ID}`)
})

test('bug create 提交完整请求体、幂等键与关联需求', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({ id: BUG_ID }))
  const result = await execute(
    [
      'bug',
      'create',
      '--project',
      PROJECT_ID,
      '--title',
      '登录按钮无响应',
      '--phenomenon',
      '点击登录按钮后页面无变化',
      '--expected',
      '显示错误提示或进入首页',
      '--reproduction',
      '1. 打开登录页\n2. 输入正确密码\n3. 点击登录',
      '--evidence',
      '浏览器控制台截图',
      '--fix-owner',
      USER_ID,
      '--requirement',
      REQUIREMENT_ID,
      '--json',
    ],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 0, result.stderr)
  const [request] = requests
  assert.ok(request)
  assert.equal(request.method, 'POST')
  assert.equal(request.path, `/api/v1/projects/${PROJECT_ID}/bugs`)
  assert.deepEqual(request.body, {
    title: '登录按钮无响应',
    phenomenon: '点击登录按钮后页面无变化',
    expectedBehavior: '显示错误提示或进入首页',
    reproduction: '1. 打开登录页\n2. 输入正确密码\n3. 点击登录',
    reproductionUnknown: false,
    evidenceText: '浏览器控制台截图',
    fixOwnerUserId: USER_ID,
    requirementIds: [REQUIREMENT_ID],
  })
  const idempotencyKey = readHeader(request.headers, 'idempotency-key')
  assert.ok(idempotencyKey)
  assert.match(idempotencyKey, UUID_PATTERN)
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    code: 'OK',
    message: 'OK',
    requestId: 'test-request',
    data: { id: BUG_ID },
  })
})

test('bug create 支持无法稳定复现，且与显式复现互斥', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({ id: BUG_ID }))
  const unknownReproduction = await execute(
    [
      'bug',
      'create',
      '--project',
      PROJECT_ID,
      '--title',
      '偶发崩溃',
      '--phenomenon',
      '随机崩溃',
      '--expected',
      '保持稳定',
      '--reproduction-unknown',
      '--json',
    ],
    { env: envFor(baseUrl) },
  )
  assert.equal(unknownReproduction.code, 0, unknownReproduction.stderr)
  assert.deepEqual(requests[0]?.body, {
    title: '偶发崩溃',
    phenomenon: '随机崩溃',
    expectedBehavior: '保持稳定',
    reproduction: null,
    reproductionUnknown: true,
  })

  const conflicting = await execute(
    [
      'bug',
      'create',
      '--project',
      PROJECT_ID,
      '--title',
      '偶发崩溃',
      '--phenomenon',
      '随机崩溃',
      '--expected',
      '保持稳定',
      '--reproduction',
      '步骤',
      '--reproduction-unknown',
      '--json',
    ],
    { env: envFor(baseUrl) },
  )
  assert.equal(conflicting.code, 2)
  assert.match(conflicting.stderr, /INVALID_REPRODUCTION/)
  assert.equal(requests.length, 1)
})

test('bug update 未指定 --expected-version 时先读取当前版本再提交变化字段', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, (request) =>
    request.method === 'GET' ? { id: BUG_ID, version: 5 } : { id: BUG_ID, version: 6, title: '新的标题' },
  )
  const result = await execute(['bug', 'update', BUG_ID, '--title', '新的标题', '--evidence', '补充证据', '--json'], {
    env: envFor(baseUrl),
  })

  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.method, 'GET')
  assert.equal(requests[0]?.path, `/api/v1/bugs/${BUG_ID}`)
  assert.equal(requests[1]?.path, `/api/v1/bugs/${BUG_ID}/update`)
  assert.deepEqual(requests[1]?.body, { version: 5, title: '新的标题', evidenceText: '补充证据' })
  assert.ok(readHeader(requests[1]?.headers ?? {}, 'idempotency-key'))
})

test('bug record-regression 使用 --expected-version 提交回归结论', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({ id: BUG_ID, status: 'resolved' }))
  const result = await execute(
    [
      'bug',
      'record-regression',
      BUG_ID,
      '--result',
      'passed',
      '--note',
      '验证通过',
      '--expected-version',
      '3',
      '--json',
    ],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.path, `/api/v1/bugs/${BUG_ID}/record-regression`)
  assert.deepEqual(requests[0]?.body, { version: 3, result: 'passed', note: '验证通过' })
  assert.ok(readHeader(requests[0]?.headers ?? {}, 'idempotency-key'))
})

test('bug record-regression 非法结论在请求前以退出码 2 拒绝', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({}))
  const result = await execute(
    ['bug', 'record-regression', BUG_ID, '--result', 'pending', '--note', '说明', '--json'],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 2)
  assert.match(result.stderr, /INVALID_RESULT/)
  assert.equal(requests.length, 0)
})

test('bug submit-regression 读取版本并提交修复说明与回归负责人', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, (request) =>
    request.method === 'GET'
      ? { id: BUG_ID, version: 4 }
      : { bug: { id: BUG_ID }, regression: { id: 'regression-1' }, activityId: 'activity-1' },
  )
  const result = await execute(
    ['bug', 'submit-regression', BUG_ID, '--fix-summary', '已修复空指针', '--verifier', USER_ID, '--json'],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(requests[1]?.path, `/api/v1/bugs/${BUG_ID}/submit-regression`)
  assert.deepEqual(requests[1]?.body, { version: 4, fixSummary: '已修复空指针', verifierUserId: USER_ID })
})

test('bug close 非交互未提供 --yes 时退出 2 且不发送请求', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({}))
  const result = await execute(
    [
      'bug',
      'close',
      BUG_ID,
      '--category',
      'duplicate',
      '--note',
      '与已有缺陷重复',
      '--duplicate-of',
      DUPLICATE_BUG_ID,
      '--json',
    ],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /CONFIRMATION_REQUIRED/)
  assert.equal(requests.length, 0)
})

test('bug close 提供 --yes 后读取版本并提交关闭分类与重复 Bug', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, (request) =>
    request.method === 'GET' ? { id: BUG_ID, version: 4 } : { id: BUG_ID, version: 5, status: 'closed' },
  )
  const result = await execute(
    [
      'bug',
      'close',
      BUG_ID,
      '--category',
      'duplicate',
      '--note',
      '与已有缺陷重复',
      '--duplicate-of',
      DUPLICATE_BUG_ID,
      '--yes',
      '--json',
    ],
    { env: envFor(baseUrl) },
  )

  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.method, 'GET')
  assert.equal(requests[1]?.path, `/api/v1/bugs/${BUG_ID}/close`)
  assert.deepEqual(requests[1]?.body, {
    version: 4,
    category: 'duplicate',
    note: '与已有缺陷重复',
    duplicateOfBugId: DUPLICATE_BUG_ID,
  })
  assert.ok(readHeader(requests[1]?.headers ?? {}, 'idempotency-key'))
})

test('bug comments 按分页参数读取并归一化输出', async (t) => {
  const comment = {
    id: 'cc6a7f8e-3a2b-4c1d-8e9f-0a1b2c3d4e5f',
    authorUserId: USER_ID,
    bodyMarkdown: '## 排查记录',
    createdAt: '2026-11-10T00:00:00.000Z',
  }
  const { baseUrl, requests } = await startRecordingServer(t, () => ({
    items: [comment],
    page: 2,
    pageSize: 5,
    total: 6,
  }))
  const result = await execute(['bug', 'comments', BUG_ID, '--page', '2', '--page-size', '5', '--json'], {
    env: envFor(baseUrl),
  })

  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests[0]?.path, `/api/v1/bugs/${BUG_ID}/comments`)
  assert.equal(requests[0]?.query.get('page'), '2')
  assert.equal(requests[0]?.query.get('pageSize'), '5')
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    code: 'OK',
    message: 'OK',
    requestId: 'test-request',
    data: { items: [comment], page: 2, pageSize: 5, total: 6 },
  })
})

test('bug comment 从标准输入读取 Markdown 并原样提交', async (t) => {
  const content = '## 复现步骤\n\n- 打开登录页\n- 点击登录\n'
  const { baseUrl, requests } = await startRecordingServer(t, () => ({ id: 'comment-1' }))
  const result = await execute(['bug', 'comment', BUG_ID, '--content-file', '-', '--json'], {
    env: envFor(baseUrl),
    stdin: content,
  })

  assert.equal(result.code, 0, result.stderr)
  const [request] = requests
  assert.ok(request)
  assert.equal(request.path, `/api/v1/bugs/${BUG_ID}/comments`)
  assert.deepEqual(request.body, { bodyMarkdown: content })
  assert.ok(readHeader(request.headers, 'idempotency-key'))
})

test('bug comment 空内容在请求前以退出码 2 拒绝', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({}))
  const result = await execute(['bug', 'comment', BUG_ID, '--content-file', '-', '--json'], {
    env: envFor(baseUrl),
    stdin: ' \n',
  })

  assert.equal(result.code, 2)
  assert.match(result.stderr, /评论内容不能为空/)
  assert.equal(requests.length, 0)
})

test('bug link-requirement 与 unlink-requirement 提交版本、关联与解除原因', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, (request) =>
    request.method === 'GET' ? { id: BUG_ID, version: 2 } : { id: BUG_ID },
  )
  const linked = await execute(
    ['bug', 'link-requirement', '--bug', BUG_ID, '--requirement', REQUIREMENT_ID, '--expected-version', '2', '--json'],
    { env: envFor(baseUrl) },
  )
  assert.equal(linked.code, 0, linked.stderr)
  assert.equal(requests[0]?.path, `/api/v1/bugs/${BUG_ID}/requirements`)
  assert.deepEqual(requests[0]?.body, { version: 2, requirementId: REQUIREMENT_ID })

  const unlinked = await execute(
    ['bug', 'unlink-requirement', '--bug', BUG_ID, '--requirement', REQUIREMENT_ID, '--reason', '需求已取消', '--json'],
    { env: envFor(baseUrl) },
  )
  assert.equal(unlinked.code, 0, unlinked.stderr)
  assert.equal(requests.length, 3)
  assert.equal(requests[1]?.method, 'GET')
  assert.equal(requests[2]?.path, `/api/v1/bugs/${BUG_ID}/requirements/${REQUIREMENT_ID}/remove`)
  assert.deepEqual(requests[2]?.body, { version: 2, reason: '需求已取消' })
})

test('bug start-fix 服务端业务失败按退出码 1 返回业务码', async (t) => {
  const baseUrl = await startStubServer(t, (_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(failureEnvelope('INVALID_TRANSITION', '只有待处理 Bug 可以开始修复'))
  })
  const result = await execute(['bug', 'start-fix', BUG_ID, '--expected-version', '2', '--json'], {
    env: envFor(baseUrl),
  })

  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /INVALID_TRANSITION/)
})

test('bug update 未提供可更新字段时退出 2 且不发送请求', async (t) => {
  const { baseUrl, requests } = await startRecordingServer(t, () => ({}))
  const result = await execute(['bug', 'update', BUG_ID, '--json'], { env: envFor(baseUrl) })

  assert.equal(result.code, 2)
  assert.match(result.stderr, /NOTHING_TO_UPDATE/)
  assert.equal(requests.length, 0)
})
