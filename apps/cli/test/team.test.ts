import assert from 'node:assert/strict'
import type { IncomingHttpHeaders } from 'node:http'
import { Command, CommanderError } from 'commander'
import { test, type TestContext } from 'node:test'
import { registerTeamCommands } from '../src/commands/team.ts'
import type { CliContext } from '../src/lib/context.ts'
import { CliError, reportError } from '../src/lib/errors.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const TOKEN = 'devops_pat_team_test_00000000000000000'

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

/** 测试用根命令：与 cli.ts 的全局选项保持一致，仅注册 team 域。 */
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
  registerTeamCommands(program, context)
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

function teamRow(id = '11111111-1111-4111-8111-111111111111') {
  return {
    id,
    name: '测试团队',
    iconText: null,
    description: null,
    version: 1,
    role: 'admin',
    status: 'active',
  }
}

function memberRow() {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    name: '测试成员',
    email: 'member@example.test',
    role: 'developer',
    status: 'active',
    joinedAt: '2026-11-10T00:00:00.000Z',
  }
}

function invitationRow() {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    teamId: '11111111-1111-4111-8111-111111111111',
    email: 'invitee@example.test',
    role: 'developer',
    status: 'pending',
    expiresAt: '2026-11-17T00:00:00.000Z',
    invitedByUserId: '22222222-2222-4222-8222-222222222222',
    deliveryStatus: 'sent',
    createdAt: '2026-11-10T00:00:00.000Z',
  }
}

test('team list 归一化 JSON 列表并携带 Bearer', async (t) => {
  const row = teamRow()
  const { url, requests } = await startRecordingServer(t, () => ({ data: { teams: [row], isPlatformAdmin: false } }))
  const result = await execute(['team', 'list', '--server', url, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'GET')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/me/teams')
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`)
  assert.deepEqual(successData(result.stdout), {
    items: [row],
    page: 1,
    pageSize: 1,
    total: 1,
    isPlatformAdmin: false,
  })
})

test('team create 发送名称与管理员邮箱', async (t) => {
  const created = { team: { id: 'team-2', name: '新团队' }, invitation: invitationRow() }
  const { url, requests } = await startRecordingServer(t, () => ({ data: created }))
  const result = await execute([
    'team',
    'create',
    '--name',
    '新团队',
    '--admin-email',
    'admin@example.test',
    '--idempotency-key',
    '44444444-4444-4444-4444-444444444444',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/platform/teams')
  assert.equal(request.headers['idempotency-key'], '44444444-4444-4444-4444-444444444444')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { name: '新团队', adminEmail: 'admin@example.test' })
  assert.deepEqual(successData(result.stdout), created)
})

test('team create 缺少管理员邮箱按参数错误退出 2', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: {} }))
  const result = await execute(['team', 'create', '--name', '新团队', '--server', url, '--json'])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.equal(errorPayload(result.stderr).code, 'MISSING_OPTION')
  assert.equal(requests.length, 0)
})

test('team member list 归一化成员列表', async (t) => {
  const row = memberRow()
  const { url, requests } = await startRecordingServer(t, () => ({ data: [row] }))
  const result = await execute(['team', 'member', 'list', '--team', 'team-1', '--server', url, '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(new URL(requestAt(requests, 0).url, url).pathname, '/api/v1/teams/team-1/members')
  assert.deepEqual(successData(result.stdout), {
    items: [row],
    page: 1,
    pageSize: 1,
    total: 1,
  })
})

test('team member list 未指定团队时自动选择唯一团队', async (t) => {
  const { url, requests } = await startRecordingServer(t, (request) =>
    request.url === '/api/v1/me'
      ? {
          data: {
            user: { id: 'user-1', name: '测试用户', email: 'user@example.test' },
            teams: [{ id: 'team-auto', name: '唯一团队', role: 'admin', status: 'active' }],
          },
        }
      : { data: [memberRow()] },
  )
  const result = await execute(['team', 'member', 'list', '--server', url, '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(requests.length, 2)
  assert.equal(new URL(requestAt(requests, 0).url, url).pathname, '/api/v1/me')
  assert.equal(new URL(requestAt(requests, 1).url, url).pathname, '/api/v1/teams/team-auto/members')
})

test('team member update 调整角色', async (t) => {
  const row = memberRow()
  const { url, requests } = await startRecordingServer(t, () => ({ data: row }))
  const result = await execute([
    'team',
    'member',
    'update',
    'user-1',
    '--role',
    'admin',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/teams/team-1/members/user-1/update')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { role: 'admin' })
  assert.deepEqual(successData(result.stdout), row)
})

test('team member update 缺少变更字段或停用缺 --yes 时退出 2 且不发请求', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: memberRow() }))
  const missing = await execute(['team', 'member', 'update', 'user-1', '--team', 'team-1', '--server', url, '--json'])
  assert.equal(missing.code, 2)
  assert.equal(errorPayload(missing.stderr).code, 'MISSING_OPTION')
  const disable = await execute([
    'team',
    'member',
    'update',
    'user-1',
    '--status',
    'disabled',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(disable.code, 2)
  assert.equal(disable.stdout, '')
  assert.equal(errorPayload(disable.stderr).code, 'CONFIRMATION_REQUIRED')
  assert.equal(requests.length, 0)
})

test('team member update 提供 --yes 后停用成员', async (t) => {
  const row = { ...memberRow(), status: 'disabled' }
  const { url, requests } = await startRecordingServer(t, () => ({ data: row }))
  const result = await execute([
    'team',
    'member',
    'update',
    'user-1',
    '--status',
    'disabled',
    '--yes',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const body: unknown = JSON.parse(requestAt(requests, 0).body)
  assert.deepEqual(body, { status: 'disabled' })
})

test('team member update 服务端业务失败按退出码 1 返回业务码', async (t) => {
  const { url } = await startRecordingServer(t, () => ({
    failure: { code: 'LAST_TEAM_ADMIN', message: '最后一位管理员不能被降级' },
  }))
  const result = await execute([
    'team',
    'member',
    'update',
    'user-1',
    '--role',
    'viewer',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.equal(errorPayload(result.stderr).code, 'LAST_TEAM_ADMIN')
})

test('team invitation list 按状态筛选并使用环境团队', async (t) => {
  const row = invitationRow()
  const { url, requests } = await startRecordingServer(t, () => ({ data: [row] }))
  const result = await execute(['team', 'invitation', 'list', '--status', 'pending', '--server', url, '--json'], {
    DEV_OPS_TEAM: 'team-env',
  })
  assert.equal(result.code, 0, result.stderr)
  const requestUrl = new URL(requestAt(requests, 0).url, url)
  assert.equal(requestUrl.pathname, '/api/v1/teams/team-env/invitations')
  assert.equal(requestUrl.searchParams.get('status'), 'pending')
  assert.deepEqual(successData(result.stdout), {
    items: [row],
    page: 1,
    pageSize: 1,
    total: 1,
  })
})

test('team invitation list 非法状态退出 2 且不发请求', async (t) => {
  const { url, requests } = await startRecordingServer(t, () => ({ data: [] }))
  const result = await execute([
    'team',
    'invitation',
    'list',
    '--status',
    'unknown',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 2)
  assert.equal(errorPayload(result.stderr).code, 'INVALID_STATUS')
  assert.equal(requests.length, 0)
})

test('team invitation create 发送邮箱与角色', async (t) => {
  const row = invitationRow()
  const { url, requests } = await startRecordingServer(t, () => ({ data: row }))
  const result = await execute([
    'team',
    'invitation',
    'create',
    '--email',
    'invitee@example.test',
    '--role',
    'developer',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/teams/team-1/invitations')
  const body: unknown = JSON.parse(request.body)
  assert.deepEqual(body, { email: 'invitee@example.test', role: 'developer' })
  assert.deepEqual(successData(result.stdout), row)
})

test('team invitation resend 调用重发接口', async (t) => {
  const row = invitationRow()
  const { url, requests } = await startRecordingServer(t, () => ({ data: row }))
  const result = await execute(['team', 'invitation', 'resend', 'inv-1', '--team', 'team-1', '--server', url, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const request = requestAt(requests, 0)
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url, url).pathname, '/api/v1/teams/team-1/invitations/inv-1/resend')
  assert.match(String(request.headers['idempotency-key']), /^[0-9a-f-]{36}$/)
})

test('team invitation revoke 缺 --yes 退出 2，提供后调用撤销接口', async (t) => {
  const row = { ...invitationRow(), status: 'revoked' }
  const { url, requests } = await startRecordingServer(t, () => ({ data: row }))
  const refused = await execute([
    'team',
    'invitation',
    'revoke',
    'inv-1',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(refused.code, 2)
  assert.equal(refused.stdout, '')
  assert.equal(errorPayload(refused.stderr).code, 'CONFIRMATION_REQUIRED')
  assert.equal(requests.length, 0)
  const revoked = await execute([
    'team',
    'invitation',
    'revoke',
    'inv-1',
    '--yes',
    '--team',
    'team-1',
    '--server',
    url,
    '--json',
  ])
  assert.equal(revoked.code, 0, revoked.stderr)
  assert.equal(new URL(requestAt(requests, 0).url, url).pathname, '/api/v1/teams/team-1/invitations/inv-1/revoke')
  assert.deepEqual(successData(revoked.stdout), row)
})
