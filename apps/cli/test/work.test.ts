import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Command, CommanderError } from 'commander'

import { registerWorkCommands } from '../src/commands/work.ts'
import type { CliContext } from '../src/lib/context.ts'
import { reportError } from '../src/lib/errors.ts'
import { normalizeRepositoryUrl } from '../src/lib/git.ts'
import { addPlanTasks, computeWorkGaps, setPlanTasksDone, type WorkItemSnapshot } from '../src/lib/work-item.ts'
import type { TrackedBinding } from '../src/lib/work-binding.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const TEAM_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_ID = '20000000-0000-4000-8000-000000000002'
const REPOSITORY_ID = '30000000-0000-4000-8000-000000000003'
const REQUIREMENT_ID = '40000000-0000-4000-8000-000000000004'
const TEST_OWNER_ID = '50000000-0000-4000-8000-000000000005'
const REMOTE_URL = 'https://github.com/acme/demo.git'

interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

/** 桩服务里的需求状态；测试按需修改以覆盖不同流转分支。 */
interface RequirementState {
  status: string
  version: number
  plan: unknown[]
  testOwners: Array<{ userId: string }>
  linkedCodeReferences: Array<{ objectType: string; remoteId: string }>
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** 创建带远端跟踪分支的临时仓库：origin 读地址指向 GitHub 以匹配项目仓库，推送地址指向本地裸仓库。 */
async function createRepository(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'devops-work-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bare = join(root, 'remote.git')
  const cwd = join(root, 'work')
  git(root, ['init', '--bare', '-b', 'main', bare])
  git(root, ['init', '-b', 'main', cwd])
  git(cwd, ['config', 'user.email', 'dev@example.com'])
  git(cwd, ['config', 'user.name', 'Dev'])
  git(cwd, ['remote', 'add', 'origin', REMOTE_URL])
  git(cwd, ['config', 'remote.origin.pushurl', bare])
  await commitFile(cwd, 'README.md', 'init')
  git(cwd, ['push', '-q', 'origin', 'main'])
  git(cwd, ['fetch', '-q', bare, 'main:refs/remotes/origin/main'])
  return cwd
}

async function commitFile(cwd: string, file: string, content: string): Promise<string> {
  await writeFile(join(cwd, file), content)
  git(cwd, ['add', file])
  git(cwd, ['commit', '-q', '-m', `改动 ${file}`])
  return git(cwd, ['rev-parse', 'HEAD'])
}

function pushToOrigin(cwd: string): void {
  git(cwd, ['push', '-q', 'origin', 'main'])
  git(cwd, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? undefined : JSON.parse(text)
}

/** 模拟 `devops work` 用到的平台接口，记录全部请求。 */
async function startPlatform(t: TestContext, state: RequirementState) {
  const requests: RecordedRequest[] = []
  const detail = () => ({
    id: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    number: 12,
    title: '登录页改版',
    attachments: [],
    ...state,
  })
  const routes: Record<string, (body: unknown) => unknown> = {
    'GET /api/v1/me': () => ({ user: { id: TEST_OWNER_ID }, teams: [{ id: TEAM_ID }] }),
    [`GET /api/v1/teams/${TEAM_ID}/projects`]: () => ({
      items: [{ id: PROJECT_ID }],
      page: 1,
      pageSize: 100,
      total: 1,
    }),
    [`GET /api/v1/projects/${PROJECT_ID}/repositories`]: () => [
      { id: REPOSITORY_ID, webUrl: 'https://github.com/acme/demo' },
    ],
    [`GET /api/v1/projects/${PROJECT_ID}/requirements`]: () => ({
      items: [{ id: REQUIREMENT_ID, number: 12 }],
      page: 1,
      pageSize: 100,
      total: 1,
    }),
    [`GET /api/v1/requirements/${REQUIREMENT_ID}`]: detail,
    [`POST /api/v1/requirements/${REQUIREMENT_ID}/start-development`]: () => {
      state.status = 'in_development'
      state.version += 1
      return detail()
    },
    [`POST /api/v1/requirements/${REQUIREMENT_ID}/update`]: () => {
      state.version += 1
      return detail()
    },
    [`POST /api/v1/requirements/${REQUIREMENT_ID}/comments`]: () => ({ id: 'comment' }),
    [`POST /api/v1/projects/${PROJECT_ID}/code-references`]: (body) => {
      if (typeof body === 'object' && body !== null && 'remoteId' in body && typeof body.remoteId === 'string') {
        state.linkedCodeReferences.push({ objectType: 'commit', remoteId: body.remoteId })
      }
      return { id: 'reference' }
    },
    [`POST /api/v1/requirements/${REQUIREMENT_ID}/submit-test`]: () => {
      state.status = 'submitted'
      return { requirement: detail(), submission: {}, activityId: 'activity' }
    },
  }
  const baseUrl = await startStubServer(t, async (incoming, response) => {
    const body = await readBody(incoming)
    const path = new URL(incoming.url ?? '/', 'http://stub.local').pathname
    const method = incoming.method ?? ''
    requests.push({ method, path, body })
    response.setHeader('content-type', 'application/json')
    const route = routes[`${method} ${path}`]
    response.end(route ? successEnvelope(route(body)) : failureEnvelope('NOT_FOUND', '资源不存在'))
  })
  return { baseUrl, requests }
}

async function execute(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = ''
  let stderr = ''
  const context: CliContext = {
    version: '1.0.0',
    env,
    cwd,
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => '',
  }
  const program = new Command()
    .option('--server <url>')
    .option('--timeout <ms>')
    .option('--json')
    .option('--team <teamId>')
    .option('--idempotency-key <uuid>')
    .exitOverride()
    .configureOutput({ writeOut: (message) => context.stdout(message), writeErr: () => undefined })
  registerWorkCommands(program, context)
  try {
    await program.parseAsync(args, { from: 'user' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (error instanceof CommanderError) return { code: 2, stdout, stderr }
    return { code: reportError(error, { json: args.includes('--json'), stderr: context.stderr }), stdout, stderr }
  }
}

function envFor(baseUrl: string): NodeJS.ProcessEnv {
  return { DEV_OPS_SERVER: baseUrl, DEV_OPS_TOKEN: 'devops_pat_work_test_token' }
}

function freshState(overrides: Partial<RequirementState> = {}): RequirementState {
  return { status: 'pending', version: 1, plan: [], testOwners: [], linkedCodeReferences: [], ...overrides }
}

function parseData(stdout: string): Record<string, unknown> {
  const envelope: unknown = JSON.parse(stdout)
  assert.ok(typeof envelope === 'object' && envelope !== null && 'data' in envelope)
  const { data } = envelope
  assert.ok(typeof data === 'object' && data !== null)
  return { ...data }
}

test('work start 按 Git 远端找到项目，把待处理需求流转为开发中并写入私有绑定', async (t) => {
  const cwd = await createRepository(t)
  const state = freshState()
  const { baseUrl, requests } = await startPlatform(t, state)

  const result = await execute(cwd, ['work', 'start', 'REQ-12', '--json'], envFor(baseUrl))

  assert.equal(result.code, 0, result.stderr)
  const data = parseData(result.stdout)
  assert.equal(data.ref, 'REQ-12')
  assert.equal(data.transitioned, true)
  assert.equal(data.status, 'in_development')
  assert.ok(requests.some((request) => request.path.endsWith('/start-development')))
  const bindingPath = join(cwd, git(cwd, ['rev-parse', '--git-path', 'devops/active.json']))
  const binding: unknown = JSON.parse(await readFile(bindingPath, 'utf8'))
  assert.ok(typeof binding === 'object' && binding !== null && 'repositoryId' in binding)
  assert.equal(binding.repositoryId, REPOSITORY_ID)
  assert.equal(git(cwd, ['status', '--porcelain']), '', '绑定文件不应出现在工作区改动中')
})

test('work start 拒绝格式错误的事项引用并以参数错误退出', async (t) => {
  const cwd = await createRepository(t)
  const result = await execute(cwd, ['work', 'start', 'TASK-1'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /REQ-<编号>/)
})

test('work start --untracked 记录无需事项的原因，status 原样返回', async (t) => {
  const cwd = await createRepository(t)
  assert.equal((await execute(cwd, ['work', 'start', '--untracked', '只回答咨询'])).code, 0)
  const status = await execute(cwd, ['work', 'status', '--json'])
  assert.equal(status.code, 0, status.stderr)
  assert.deepEqual(parseData(status.stdout), { binding: 'untracked', reason: '只回答咨询', gaps: [] })
})

test('work status 未绑定时不访问服务并返回 none', async (t) => {
  const cwd = await createRepository(t)
  const result = await execute(cwd, ['work', 'status', '--json'], envFor('http://127.0.0.1:9'))
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(parseData(result.stdout), { binding: 'none', gaps: [] })
})

test('work task add 在空规划中创建默认节点并按版本写回', async (t) => {
  const cwd = await createRepository(t)
  const state = freshState({ status: 'in_development' })
  const { baseUrl, requests } = await startPlatform(t, state)
  assert.equal((await execute(cwd, ['work', 'start', 'REQ-12'], envFor(baseUrl))).code, 0)

  const result = await execute(cwd, ['work', 'task', 'add', '后端接口', '前端页面', '--json'], envFor(baseUrl))

  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(parseData(result.stdout).added, ['t1', 't2'])
  const update = requests.find((request) => request.path.endsWith('/update'))
  assert.deepEqual(update?.body, {
    version: 1,
    plan: [
      {
        id: 'develop',
        title: '开发',
        startsOn: null,
        endsOn: null,
        tasks: [
          { id: 't1', title: '后端接口', startsOn: null, endsOn: null, done: false },
          { id: 't2', title: '前端页面', startsOn: null, endsOn: null, done: false },
        ],
      },
    ],
  })
})

test('work status 在出现新提交后要求回写，deliver 关联提交、写记录并用默认测试负责人提测', async (t) => {
  const cwd = await createRepository(t)
  const state = freshState({ status: 'in_development', testOwners: [{ userId: TEST_OWNER_ID }] })
  const { baseUrl, requests } = await startPlatform(t, state)
  assert.equal((await execute(cwd, ['work', 'start', 'REQ-12'], envFor(baseUrl))).code, 0)
  const sha = await commitFile(cwd, 'login.ts', 'export {}')
  pushToOrigin(cwd)

  const before = parseData((await execute(cwd, ['work', 'status', '--json'], envFor(baseUrl))).stdout)
  const blocking = (before.gaps as Array<{ code: string; blocking: boolean }>).filter((gap) => gap.blocking)
  assert.deepEqual(
    blocking.map((gap) => gap.code),
    ['UNLINKED_COMMITS', 'UNREPORTED_COMMITS'],
  )

  const delivered = await execute(
    cwd,
    ['work', 'deliver', '--summary', '登录页', '--verification', 'pnpm check 通过', '--self-test', 'passed', '--json'],
    envFor(baseUrl),
  )
  assert.equal(delivered.code, 0, delivered.stderr)
  assert.deepEqual(parseData(delivered.stdout).transition, { status: 'submitted' })
  const reference = requests.find((request) => request.path.endsWith('/code-references'))
  assert.deepEqual(reference?.body, {
    targetType: 'requirement',
    targetId: REQUIREMENT_ID,
    repositoryId: REPOSITORY_ID,
    objectType: 'commit',
    remoteId: sha,
  })
  const submit = requests.find((request) => request.path.endsWith('/submit-test'))
  assert.deepEqual(submit?.body, {
    version: 1,
    testOwnerUserId: TEST_OWNER_ID,
    scopeNote: '登录页',
    selfTestResult: 'passed',
  })

  const after = parseData((await execute(cwd, ['work', 'status', '--json'], envFor(baseUrl))).stdout)
  assert.deepEqual(
    (after.gaps as Array<{ blocking: boolean }>).filter((gap) => gap.blocking),
    [],
  )
})

test('work deliver 需求缺少自测结论时以参数错误退出且不访问服务', async (t) => {
  const cwd = await createRepository(t)
  const state = freshState({ status: 'in_development' })
  const { baseUrl, requests } = await startPlatform(t, state)
  assert.equal((await execute(cwd, ['work', 'start', 'REQ-12'], envFor(baseUrl))).code, 0)
  const count = requests.length

  const result = await execute(
    cwd,
    ['work', 'deliver', '--summary', '登录页', '--verification', '已测'],
    envFor(baseUrl),
  )

  assert.equal(result.code, 2)
  assert.match(result.stderr, /--self-test/)
  assert.equal(requests.length, count)
})

test('work deliver 没有测试负责人时只回写记录并说明未提测原因', async (t) => {
  const cwd = await createRepository(t)
  const state = freshState({ status: 'in_development' })
  const { baseUrl, requests } = await startPlatform(t, state)
  assert.equal((await execute(cwd, ['work', 'start', 'REQ-12'], envFor(baseUrl))).code, 0)

  const result = await execute(
    cwd,
    ['work', 'deliver', '--summary', '登录页', '--verification', '未运行检查', '--self-test', 'not_run', '--json'],
    envFor(baseUrl),
  )

  assert.equal(result.code, 0, result.stderr)
  const transition = parseData(result.stdout).transition as { status: string; skipped?: string }
  assert.equal(transition.status, 'in_development')
  assert.match(transition.skipped ?? '', /测试负责人/)
  assert.ok(requests.some((request) => request.path.endsWith('/comments')))
  assert.ok(!requests.some((request) => request.path.endsWith('/submit-test')))
})

test('work 命令在服务不可达时以退出码 1 失败', async (t) => {
  const cwd = await createRepository(t)
  const result = await execute(cwd, ['work', 'start', 'REQ-12', '--timeout', '500'], envFor('http://127.0.0.1:9'))
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
})

test('computeWorkGaps 只在 HEAD 超过最近回写点时要求回写', () => {
  const binding: TrackedBinding = {
    mode: 'tracked',
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    kind: 'requirement',
    itemId: REQUIREMENT_ID,
    number: 12,
    title: '登录页改版',
    baseSha: 'base',
    startedAt: '2026-11-26T00:00:00.000Z',
    reported: { head: 'head-1', at: '2026-11-26T01:00:00.000Z' },
    delivered: null,
  }
  const item: WorkItemSnapshot = {
    kind: 'requirement',
    id: REQUIREMENT_ID,
    ref: 'REQ-12',
    number: 12,
    title: '登录页改版',
    status: 'in_development',
    version: 3,
    projectId: PROJECT_ID,
    plan: [],
    attachmentIds: [],
    linkedCommitShas: [],
    testOwnerUserIds: [TEST_OWNER_ID],
  }
  const commits = [{ sha: 'head-1', subject: '改动', isPushed: false, isLinked: false }]
  const codes = (head: string, workspaces: string[] = []) =>
    computeWorkGaps({ binding, item, commits, head, workspaces }).map((gap) => gap.code)

  assert.deepEqual(codes('head-1'), [])
  assert.deepEqual(codes('head-2'), ['UNREPORTED_COMMITS'])
  assert.deepEqual(codes('head-1', ['apps/server', 'apps/web']), ['PLAN_EMPTY'])
})

test('规划待办增删改校验节点与编号', () => {
  const { plan } = addPlanTasks([], ['接口'], undefined)
  assert.throws(() => addPlanTasks(plan, ['页面'], 'missing'), /规划节点不存在/)
  assert.equal(setPlanTasksDone(plan, ['t1'], true)[0]?.tasks[0]?.done, true)
  assert.throws(() => setPlanTasksDone(plan, ['t9'], true), /待办不存在/)
})

test('normalizeRepositoryUrl 统一 HTTPS、SSH 与 scp 形式', () => {
  const expected = 'github.com/acme/demo'
  assert.equal(normalizeRepositoryUrl('https://github.com/acme/demo'), expected)
  assert.equal(normalizeRepositoryUrl('https://token@github.com/Acme/demo.git'), expected)
  assert.equal(normalizeRepositoryUrl('git@github.com:acme/demo.git'), expected)
  assert.equal(normalizeRepositoryUrl('ssh://git@github.com:22/acme/demo.git'), expected)
})
