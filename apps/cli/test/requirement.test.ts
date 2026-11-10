import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { Command, CommanderError } from 'commander'
import { registerRequirementCommands } from '../src/commands/requirement.ts'
import type { CliContext } from '../src/lib/context.ts'
import { CliError, reportError } from '../src/lib/errors.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const TOKEN = 'devops_pat_abcdefghijklmnopqrstuvwxyz012345'

// 隔离本地配置，避免读取开发机上的 devops 配置文件影响断言。
const configHome = mkdtempSync(join(tmpdir(), 'devops-cli-requirement-test-'))
process.env.XDG_CONFIG_HOME = configHome
after(() => {
  rmSync(configHome, { recursive: true, force: true })
})

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 按 CLI 入口相同的方式组装 requirement 命令并执行。
 * 命令域测试不经过 cli.ts 的注册表，避免依赖其他命令域的并行改动。
 */
async function execute(
  args: string[],
  input = '',
  env: NodeJS.ProcessEnv = { DEV_OPS_TOKEN: TOKEN },
): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  const context: CliContext = {
    version: '1.2.3',
    env,
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => input,
  }
  const program = new Command()
  program
    .name('devops')
    .version(context.version, '-v, --version')
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
  registerRequirementCommands(program, context)
  try {
    await program.parseAsync(args, { from: 'user' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.version', 'commander.help'].includes(error.code)) {
        return { code: 0, stdout, stderr }
      }
      const message = error.message.replace(/^error:\s*/i, '').trim() || '参数无法识别'
      const code = reportError(new CliError(message, 2, { code: 'INVALID_ARGUMENTS' }), {
        json: false,
        stderr: context.stderr,
      })
      return { code, stdout, stderr }
    }
    const code = reportError(error, { json: args.includes('--json'), stderr: context.stderr })
    return { code, stdout, stderr }
  }
}

interface RecordedRequest {
  method: string
  pathname: string
  query: URLSearchParams
  headers: IncomingHttpHeaders
  body: unknown
}

type StubResponder = (request: RecordedRequest) => unknown

/** 启动记录请求的本地桩服务，统一返回平台成功信封。 */
async function startStub(
  t: TestContext,
  responder: StubResponder,
): Promise<{ baseUrl: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = []
  const baseUrl = await startStubServer(t, (request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown
      try {
        body = raw.length === 0 ? undefined : JSON.parse(raw)
      } catch {
        body = raw
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        pathname: url.pathname,
        query: url.searchParams,
        headers: request.headers,
        body,
      }
      requests.push(recorded)
      try {
        response.setHeader('content-type', 'application/json')
        response.end(successEnvelope(responder(recorded), 'stub-request'))
      } catch (error) {
        response.statusCode = 500
        response.end(
          JSON.stringify({
            success: false,
            code: 'STUB_ERROR',
            message: error instanceof Error ? error.message : '桩服务未处理请求',
            requestId: 'stub-request',
          }),
        )
      }
    })
  })
  return { baseUrl, requests }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonBody(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) assert.fail(`不是 JSON 对象：${text}`)
  return value
}

/** 断言命令成功并返回 JSON 信封中的 data。 */
function successData(result: ExecResult): unknown {
  assert.equal(result.code, 0, result.stderr)
  const payload = jsonBody(result.stdout)
  assert.equal(payload.success, true)
  return payload.data
}

/** 断言值是非数组并返回，避免测试里出现隐式 any。 */
function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) assert.fail('期望数组')
  return value
}

test('requirement list 输出归一化分页并传递筛选与分页参数', async (t) => {
  const stub = await startStub(t, (request) => {
    assert.equal(request.method, 'GET')
    assert.equal(request.pathname, '/api/v1/projects/project-1/requirements')
    return {
      items: [{ id: 'requirement-1', title: '登录需求', status: 'in_development' }],
      page: 2,
      pageSize: 1,
      total: 5,
    }
  })
  const result = await execute([
    'requirement',
    'list',
    '--server',
    stub.baseUrl,
    '--json',
    '--project',
    'project-1',
    '--search',
    '登录',
    '--status',
    'in_development',
    '--owner',
    'user-1',
    '--owner-unavailable',
    '--page',
    '2',
    '--page-size',
    '1',
  ])
  assert.deepEqual(successData(result), {
    items: [{ id: 'requirement-1', title: '登录需求', status: 'in_development' }],
    page: 2,
    pageSize: 1,
    total: 5,
  })
  assert.equal(result.stderr, '')
  const [request] = stub.requests
  assert.equal(request?.query.get('search'), '登录')
  assert.equal(request?.query.get('status'), 'in_development')
  assert.equal(request?.query.get('ownerId'), 'user-1')
  assert.equal(request?.query.get('ownerUnavailable'), 'true')
  assert.equal(request?.query.get('page'), '2')
  assert.equal(request?.query.get('pageSize'), '1')
})

test('requirement list 把服务端裸数组归一化为分页结构', async (t) => {
  const stub = await startStub(t, () => [{ id: 'requirement-1' }, { id: 'requirement-2' }])
  const result = await execute(['requirement', 'list', '--server', stub.baseUrl, '--json', '--project', 'project-1'])
  assert.deepEqual(successData(result), {
    items: [{ id: 'requirement-1' }, { id: 'requirement-2' }],
    page: 1,
    pageSize: 2,
    total: 2,
  })
})

test('requirement list --all 逐页读取全部数据', async (t) => {
  const pageSize = 20
  const firstPage = Array.from({ length: pageSize }, (_value, index) => ({ id: `requirement-${index}` }))
  const stub = await startStub(t, (request) => {
    const page = Number(request.query.get('page'))
    if (page === 1) return { items: firstPage, page: 1, pageSize, total: pageSize + 1 }
    return { items: [{ id: 'requirement-last' }], page: 2, pageSize, total: pageSize + 1 }
  })
  const result = await execute([
    'requirement',
    'list',
    '--server',
    stub.baseUrl,
    '--json',
    '--project',
    'project-1',
    '--all',
  ])
  const data = successData(result)
  if (!isRecord(data)) assert.fail('列表数据不是对象')
  assert.equal(expectArray(data.items).length, pageSize + 1)
  assert.equal(data.total, pageSize + 1)
  assert.deepEqual(
    stub.requests.map((request) => request.query.get('page')),
    ['1', '2'],
  )
})

test('requirement get 输出详情字段', async (t) => {
  const stub = await startStub(t, () => ({
    id: 'requirement-1',
    number: 3,
    title: '登录需求',
    status: 'in_testing',
    version: 7,
    needsReview: true,
    devOwner: { userId: 'user-1', name: '研发', status: 'active', available: true },
  }))
  const result = await execute(['requirement', 'get', 'requirement-1', '--server', stub.baseUrl, '--json'])
  assert.deepEqual(successData(result), {
    id: 'requirement-1',
    number: 3,
    title: '登录需求',
    status: 'in_testing',
    version: 7,
    needsReview: true,
    devOwner: { userId: 'user-1', name: '研发', status: 'active', available: true },
  })
  assert.equal(stub.requests[0]?.pathname, '/api/v1/requirements/requirement-1')
})

test('requirement create 从标准输入读取正文并提交必填字段与幂等键', async (t) => {
  const stub = await startStub(t, (request) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.pathname, '/api/v1/projects/project-1/requirements')
    return { id: 'requirement-1' }
  })
  const result = await execute(
    [
      'requirement',
      'create',
      '--server',
      stub.baseUrl,
      '--json',
      '--project',
      'project-1',
      '--title',
      '登录需求',
      '--content-file',
      '-',
      '--acceptance',
      '可以登录',
      '--dev-owner',
      'user-1',
      '--test-owner',
      'user-2',
      '--collaborator',
      'user-3',
      '--collaborator',
      'user-4',
      '--idempotency-key',
      'fixed-idempotency-key',
    ],
    '# 登录需求\n\n支持邮箱登录',
  )
  assert.deepEqual(successData(result), { id: 'requirement-1' })
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.deepEqual(request.body, {
    title: '登录需求',
    contentMode: 'markdown',
    contentMarkdown: '# 登录需求\n\n支持邮箱登录',
    acceptanceCriteria: '可以登录',
    devOwnerUserId: 'user-1',
    testOwnerUserId: 'user-2',
    collaboratorUserIds: ['user-3', 'user-4'],
  })
  assert.equal(request.headers['idempotency-key'], 'fixed-idempotency-key')
})

test('requirement create 缺少必填内容方式时退出 2 且不发送请求', async (t) => {
  const stub = await startStub(t, () => {
    throw new Error('不应发送请求')
  })
  for (const args of [
    ['requirement', 'create', '--server', stub.baseUrl],
    ['requirement', 'create', '--server', stub.baseUrl, '--project', 'project-1'],
    ['requirement', 'create', '--server', stub.baseUrl, '--project', 'project-1', '--title', '登录需求'],
    [
      'requirement',
      'create',
      '--server',
      stub.baseUrl,
      '--project',
      'project-1',
      '--title',
      '登录需求',
      '--external-summary',
      '摘要',
    ],
  ]) {
    const result = await execute(args)
    assert.equal(result.code, 2, JSON.stringify(args))
    assert.equal(result.stdout, '')
  }
  assert.equal(stub.requests.length, 0)
})

test('requirement update 使用 --expected-version 提交字段且不预读详情', async (t) => {
  const stub = await startStub(t, (request) => {
    assert.equal(request.pathname, '/api/v1/requirements/requirement-1/update')
    return { id: 'requirement-1', version: 8 }
  })
  const result = await execute([
    'requirement',
    'update',
    'requirement-1',
    '--server',
    stub.baseUrl,
    '--json',
    '--expected-version',
    '7',
    '--title',
    '新标题',
    '--acceptance',
    '新验收标准',
    '--dev-owner',
    'user-1',
  ])
  assert.deepEqual(successData(result), { id: 'requirement-1', version: 8 })
  assert.equal(stub.requests.length, 1)
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.equal(request.method, 'POST')
  assert.deepEqual(request.body, {
    version: 7,
    title: '新标题',
    acceptanceCriteria: '新验收标准',
    devOwnerUserId: 'user-1',
  })
})

test('requirement update 省略版本时先读取当前版本再提交正文', async (t) => {
  const stub = await startStub(t, (request) => {
    if (request.method === 'GET') return { id: 'requirement-1', version: 5 }
    return { id: 'requirement-1', version: 6 }
  })
  const result = await execute(
    ['requirement', 'update', 'requirement-1', '--server', stub.baseUrl, '--json', '--content-file', '-'],
    '更新后的正文',
  )
  assert.deepEqual(successData(result), { id: 'requirement-1', version: 6 })
  assert.deepEqual(
    stub.requests.map((request) => `${request.method} ${request.pathname}`),
    ['GET /api/v1/requirements/requirement-1', 'POST /api/v1/requirements/requirement-1/update'],
  )
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.deepEqual(request.body, { version: 5, contentMode: 'markdown', contentMarkdown: '更新后的正文' })
})

test('requirement submit-test 校验必填并自动读取版本后提交', async (t) => {
  const stub = await startStub(t, (request) => {
    if (request.method === 'GET') return { id: 'requirement-1', version: 7 }
    return {
      requirement: { id: 'requirement-1', status: 'submitted' },
      submission: { id: 'submission-1' },
      activityId: 'activity-1',
    }
  })
  const missing = await execute([
    'requirement',
    'submit-test',
    'requirement-1',
    '--server',
    stub.baseUrl,
    '--test-owner',
    'user-2',
  ])
  assert.equal(missing.code, 2)
  assert.equal(stub.requests.length, 0)
  const invalidResult = await execute([
    'requirement',
    'submit-test',
    'requirement-1',
    '--server',
    stub.baseUrl,
    '--test-owner',
    'user-2',
    '--scope-note',
    '登录与注册',
    '--self-test-result',
    'unknown',
  ])
  assert.equal(invalidResult.code, 2)
  assert.equal(stub.requests.length, 0)

  const result = await execute([
    'requirement',
    'submit-test',
    'requirement-1',
    '--server',
    stub.baseUrl,
    '--json',
    '--test-owner',
    'user-2',
    '--scope-note',
    '登录与注册',
    '--self-test-result',
    'passed',
    '--self-test-note',
    '自测通过',
    '--test-entry',
    'https://example.test/login',
    '--version-note',
    'v1',
  ])
  assert.deepEqual(successData(result), {
    requirement: { id: 'requirement-1', status: 'submitted' },
    submission: { id: 'submission-1' },
    activityId: 'activity-1',
  })
  assert.deepEqual(
    stub.requests.map((request) => `${request.method} ${request.pathname}`),
    ['GET /api/v1/requirements/requirement-1', 'POST /api/v1/requirements/requirement-1/submit-test'],
  )
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.deepEqual(request.body, {
    version: 7,
    testOwnerUserId: 'user-2',
    scopeNote: '登录与注册',
    selfTestResult: 'passed',
    selfTestNote: '自测通过',
    testEntry: 'https://example.test/login',
    versionNote: 'v1',
  })
})

test('需求状态动作提交版本、原因、关联 Bug 与结论', async (t) => {
  const stub = await startStub(t, () => ({ id: 'requirement-1', status: 'in_development' }))
  const cases = [
    {
      args: ['start-development', 'requirement-1', '--expected-version', '7'],
      pathname: '/api/v1/requirements/requirement-1/start-development',
      body: { version: 7 },
    },
    {
      args: ['start-test', 'requirement-1', '--expected-version', '7'],
      pathname: '/api/v1/requirements/requirement-1/start-test',
      body: { version: 7 },
    },
    {
      args: ['withdraw-test', 'requirement-1', '--expected-version', '7', '--reason', '自测未通过'],
      pathname: '/api/v1/requirements/requirement-1/withdraw-test',
      body: { version: 7, reason: '自测未通过' },
    },
    {
      args: [
        'return-to-development',
        'requirement-1',
        '--expected-version',
        '7',
        '--reason',
        '发现缺陷',
        '--link-bug',
        'bug-1',
        '--link-bug',
        'bug-2',
      ],
      pathname: '/api/v1/requirements/requirement-1/return-to-development',
      body: { version: 7, reason: '发现缺陷', linkedBugIds: ['bug-1', 'bug-2'] },
    },
    {
      args: ['reopen-development', 'requirement-1', '--expected-version', '7', '--reason', '需求变更'],
      pathname: '/api/v1/requirements/requirement-1/reopen-development',
      body: { version: 7, reason: '需求变更' },
    },
    {
      args: ['restore', 'requirement-1', '--expected-version', '7', '--reason', '误取消'],
      pathname: '/api/v1/requirements/requirement-1/restore',
      body: { version: 7, reason: '误取消' },
    },
    {
      args: ['cancel', 'requirement-1', '--expected-version', '7', '--reason', '不再需要', '--yes'],
      pathname: '/api/v1/requirements/requirement-1/cancel',
      body: { version: 7, reason: '不再需要' },
    },
  ]
  for (const item of cases) {
    const result = await execute(['requirement', ...item.args, '--server', stub.baseUrl, '--json'])
    assert.equal(result.code, 0, `${item.args[0] ?? '动作'}: ${result.stderr}`)
    const request = stub.requests.at(-1)
    assert.ok(request)
    assert.equal(request.method, 'POST')
    assert.equal(request.pathname, item.pathname)
    assert.deepEqual(request.body, item.body)
  }
  assert.equal(stub.requests.length, cases.length)
})

test('requirement cancel 无 --yes 时退出 2 且不发送请求', async (t) => {
  const stub = await startStub(t, () => {
    throw new Error('不应发送请求')
  })
  const result = await execute([
    'requirement',
    'cancel',
    'requirement-1',
    '--reason',
    '不再需要',
    '--server',
    stub.baseUrl,
    '--json',
  ])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(stub.requests.length, 0)
  const error = jsonBody(result.stderr)
  assert.equal(error.code, 'CONFIRMATION_REQUIRED')
  assert.match(String(error.message), /--yes/)
})

test('requirement pass-test 先检查测试条件并列出阻碍 Bug', async (t) => {
  const stub = await startStub(t, (request) => {
    assert.equal(request.pathname, '/api/v1/requirements/requirement-1/test-pass-eligibility')
    return { eligible: false, blockers: [{ id: 'bug-1', number: 12, title: '登录失败', status: 'open' }] }
  })
  const result = await execute([
    'requirement',
    'pass-test',
    'requirement-1',
    '--conclusion',
    '测试通过',
    '--expected-version',
    '7',
    '--server',
    stub.baseUrl,
    '--json',
  ])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.equal(stub.requests.length, 1)
  const error = jsonBody(result.stderr)
  assert.equal(error.code, 'PRECONDITION_FAILED')
  assert.match(String(error.message), /登录失败/)
  assert.match(String(error.message), /#12/)
})

test('requirement eligibility 输出条件，满足时 pass-test 提交结论', async (t) => {
  const stub = await startStub(t, (request) => {
    if (request.method === 'GET') return { eligible: true, blockers: [] }
    return { id: 'requirement-1', status: 'passed' }
  })
  const eligibility = await execute(['requirement', 'eligibility', 'requirement-1', '--server', stub.baseUrl, '--json'])
  assert.deepEqual(successData(eligibility), { eligible: true, blockers: [] })

  const passed = await execute([
    'requirement',
    'pass-test',
    'requirement-1',
    '--conclusion',
    '回归通过',
    '--expected-version',
    '7',
    '--server',
    stub.baseUrl,
    '--json',
  ])
  assert.deepEqual(successData(passed), { id: 'requirement-1', status: 'passed' })
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.equal(request.pathname, '/api/v1/requirements/requirement-1/pass-test')
  assert.deepEqual(request.body, { version: 7, conclusion: '回归通过' })
})

test('评论、活动与提测历史按分页读取并归一化输出', async (t) => {
  const stub = await startStub(t, (request) => ({
    items: [{ id: request.pathname }],
    page: 2,
    pageSize: 5,
    total: 6,
  }))
  for (const name of ['comments', 'activities', 'test-submissions']) {
    const result = await execute([
      'requirement',
      name,
      'requirement-1',
      '--server',
      stub.baseUrl,
      '--json',
      '--page',
      '2',
      '--page-size',
      '5',
    ])
    assert.deepEqual(successData(result), {
      items: [{ id: `/api/v1/requirements/requirement-1/${name}` }],
      page: 2,
      pageSize: 5,
      total: 6,
    })
    const request = stub.requests.at(-1)
    assert.ok(request)
    assert.equal(request.query.get('page'), '2')
    assert.equal(request.query.get('pageSize'), '5')
  }
})

test('requirement comment 从标准输入读取 Markdown 并提交', async (t) => {
  const stub = await startStub(t, (request) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.pathname, '/api/v1/requirements/requirement-1/comments')
    return { id: 'comment-1' }
  })
  const result = await execute(
    ['requirement', 'comment', 'requirement-1', '--content-file', '-', '--server', stub.baseUrl, '--json'],
    '## 进展\n\n已联调',
  )
  assert.deepEqual(successData(result), { id: 'comment-1' })
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.deepEqual(request.body, { bodyMarkdown: '## 进展\n\n已联调' })
  assert.equal(typeof request.headers['idempotency-key'], 'string')
})

test('requirement comment 空内容退出 2 且不发送请求', async (t) => {
  const stub = await startStub(t, () => {
    throw new Error('不应发送请求')
  })
  const result = await execute(
    ['requirement', 'comment', 'requirement-1', '--content-file', '-', '--server', stub.baseUrl],
    '   \n',
  )
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(stub.requests.length, 0)
})

test('非法需求状态、分页与版本参数在请求前退出 2', async (t) => {
  const stub = await startStub(t, () => {
    throw new Error('不应发送请求')
  })
  for (const args of [
    ['requirement', 'list', '--server', stub.baseUrl, '--project', 'project-1', '--status', 'unknown'],
    ['requirement', 'list', '--server', stub.baseUrl, '--project', 'project-1', '--page', '0'],
    [
      'requirement',
      'start-development',
      'requirement-1',
      '--server',
      stub.baseUrl,
      '--expected-version',
      'not-a-number',
    ],
  ]) {
    const result = await execute(args)
    assert.equal(result.code, 2, JSON.stringify(args))
    assert.equal(result.stdout, '')
  }
  assert.equal(stub.requests.length, 0)
})

test('旧版本冲突按业务失败退出 1 并保留错误码', async (t) => {
  const server = await startStubServer(t, (_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(failureEnvelope('VERSION_CONFLICT', '需求已被更新，请刷新后重试'))
  })
  const result = await execute([
    'requirement',
    'restore',
    'requirement-1',
    '--reason',
    '误取消',
    '--expected-version',
    '3',
    '--server',
    server,
    '--json',
  ])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  const error = jsonBody(result.stderr)
  assert.equal(error.code, 'VERSION_CONFLICT')
})

test('requirement create 根据外链参数提交外链内容', async (t) => {
  const stub = await startStub(t, (request) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.pathname, '/api/v1/projects/project-1/requirements')
    return { id: 'requirement-1' }
  })
  const result = await execute([
    'requirement',
    'create',
    '--server',
    stub.baseUrl,
    '--json',
    '--project',
    'project-1',
    '--title',
    '外部需求',
    '--external-url',
    'https://example.test/spec',
    '--external-summary',
    '外部文档摘要',
  ])
  assert.deepEqual(successData(result), { id: 'requirement-1' })
  const request = stub.requests.at(-1)
  assert.ok(request)
  assert.deepEqual(request.body, {
    title: '外部需求',
    contentMode: 'external_link',
    externalUrl: 'https://example.test/spec',
    externalSummary: '外部文档摘要',
  })
})

test('requirement 帮助离线展示全部子命令', async () => {
  const result = await execute(['requirement', '--help'])
  assert.equal(result.code, 0)
  assert.equal(result.stderr, '')
  for (const name of [
    'list',
    'get',
    'comments',
    'activities',
    'test-submissions',
    'eligibility',
    'create',
    'update',
    'comment',
    'start-development',
    'submit-test',
    'start-test',
    'withdraw-test',
    'return-to-development',
    'pass-test',
    'reopen-development',
    'cancel',
    'restore',
  ]) {
    assert.match(result.stdout, new RegExp(name))
  }
})
