import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Command, CommanderError } from 'commander'
import { registerCodeCommands } from '../src/commands/code.ts'
import type { CliContext } from '../src/lib/context.ts'
import { reportError } from '../src/lib/errors.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

const API_TOKEN = 'devops_pat_test_token_abcdefghijklmnop'
const PROJECT_ID = 'project-1'
const REPOSITORY_ID = 'repo-1'

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
  configDirectory = await mkdtemp(join(tmpdir(), 'devops-cli-code-'))
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

/** 与 cli.ts 一致的全局选项与错误处理，便于直接测试 code 命令域。 */
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
  registerCodeCommands(program, context)
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

function codeReferenceView() {
  return {
    id: 'ref-1',
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    targetType: 'requirement',
    targetId: 'requirement-1',
    objectType: 'commit',
    remoteId: 'abc1234',
    title: 'feat: 示例提交',
    state: 'merged',
    url: 'https://git.example.test/dev-ops/repo-1/commit/abc1234',
    lastCheckStatus: 'ok',
    lastErrorCode: null,
    lastCheckedAt: '2026-11-10T00:00:00.000Z',
  }
}

test('project repository branches/tree/file 输出分支、树与文件 JSON', async (t) => {
  const { server, requests } = await startJsonStub(t, (request) => {
    const url = new URL(request.path, 'http://127.0.0.1')
    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/repositories/${REPOSITORY_ID}/branches`) {
      return successEnvelope({ branches: ['main', 'feature/x'] })
    }
    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/repositories/${REPOSITORY_ID}/tree`) {
      const branch = url.searchParams.get('branch') ?? 'main'
      return successEnvelope({
        branch,
        entries: [{ path: 'README.md', type: 'file', size: 12 }],
      })
    }
    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/repositories/${REPOSITORY_ID}/file`) {
      return successEnvelope({
        branch: url.searchParams.get('branch') ?? 'main',
        path: url.searchParams.get('path') ?? '',
        content: 'export const answer = 42\n',
        truncated: true,
      })
    }
    return failureEnvelope('NOT_FOUND', '未预期的请求')
  })

  const branches = await execute([
    'project',
    'repository',
    'branches',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--server',
    server,
    '--json',
  ])
  assert.equal(branches.code, 0, branches.stderr)
  assert.deepEqual(JSON.parse(branches.stdout).data.branches, ['main', 'feature/x'])

  const defaultTree = await execute([
    'project',
    'repository',
    'tree',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--server',
    server,
    '--json',
  ])
  assert.equal(defaultTree.code, 0, defaultTree.stderr)
  assert.equal(JSON.parse(defaultTree.stdout).data.branch, 'main')
  assert.equal(requests.length, 2)
  const defaultTreeUrl = new URL(requests[1]?.path ?? '', 'http://127.0.0.1')
  assert.equal(defaultTreeUrl.searchParams.get('branch'), null)

  const branchTree = await execute([
    'project',
    'repository',
    'tree',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--branch',
    'dev',
    '--server',
    server,
    '--json',
  ])
  assert.equal(branchTree.code, 0, branchTree.stderr)
  assert.equal(JSON.parse(branchTree.stdout).data.branch, 'dev')
  assert.equal(new URL(requests[2]?.path ?? '', 'http://127.0.0.1').searchParams.get('branch'), 'dev')

  const file = await execute([
    'project',
    'repository',
    'file',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--branch',
    'main',
    '--path',
    'src/index.ts',
    '--server',
    server,
    '--json',
  ])
  assert.equal(file.code, 0, file.stderr)
  const filePayload = JSON.parse(file.stdout)
  assert.equal(filePayload.data.path, 'src/index.ts')
  assert.equal(filePayload.data.truncated, true)
  const fileUrl = new URL(requests[3]?.path ?? '', 'http://127.0.0.1')
  assert.equal(fileUrl.searchParams.get('branch'), 'main')
  assert.equal(fileUrl.searchParams.get('path'), 'src/index.ts')
})

test('project code-reference add 发送关联字段，并拒绝非法类型', async (t) => {
  const { server, requests } = await startJsonStub(t, () => successEnvelope(codeReferenceView()))
  const result = await execute([
    'project',
    'code-reference',
    'add',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--target-type',
    'requirement',
    '--target-id',
    'requirement-1',
    '--object-type',
    'commit',
    '--remote-id',
    'abc1234',
    '--server',
    server,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const request = requests[0]
  assert.ok(request)
  assert.equal(request.method, 'POST')
  assert.equal(request.path, `/api/v1/projects/${PROJECT_ID}/code-references`)
  assert.deepEqual(JSON.parse(request.body), {
    targetType: 'requirement',
    targetId: 'requirement-1',
    repositoryId: REPOSITORY_ID,
    objectType: 'commit',
    remoteId: 'abc1234',
  })
  assert.equal(JSON.parse(result.stdout).data.id, 'ref-1')

  const invalid = await execute(
    [
      'project',
      'code-reference',
      'add',
      PROJECT_ID,
      '--repository',
      REPOSITORY_ID,
      '--target-type',
      'pull-request',
      '--target-id',
      'requirement-1',
      '--object-type',
      'commit',
      '--remote-id',
      'abc1234',
    ],
    {},
  )
  assert.equal(invalid.code, 2)
  assert.equal(invalid.stdout, '')
  assert.equal(requests.length, 1)
})

test('project code-reference remove 无 --yes 拒绝，带 --yes 才发送原因', async (t) => {
  const { server, requests } = await startJsonStub(t, () => successEnvelope({ removed: true }))
  const args = [
    'project',
    'code-reference',
    'remove',
    PROJECT_ID,
    '--reference',
    'ref-1',
    '--reason',
    '关联错误',
    '--server',
    server,
  ]

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
  assert.equal(request.path, '/api/v1/code-references/ref-1/remove')
  assert.deepEqual(JSON.parse(request.body), { reason: '关联错误' })
  assert.equal(JSON.parse(accepted.stdout).data.removed, true)
})

test('code-reference refresh 对来源状态发起刷新请求', async (t) => {
  const { server, requests } = await startJsonStub(t, () =>
    successEnvelope({ ...codeReferenceView(), lastCheckStatus: 'source_unavailable' }),
  )
  const result = await execute(['code-reference', 'refresh', 'ref-1', '--server', server, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const request = requests[0]
  assert.ok(request)
  assert.equal(request.method, 'POST')
  assert.equal(request.path, '/api/v1/code-references/ref-1/refresh')
  assert.equal(request.body, '')
  assert.equal(JSON.parse(result.stdout).data.lastCheckStatus, 'source_unavailable')
})

test('复用 project 命令组，不重复注册同名组', () => {
  const context: CliContext = {
    version: 'test',
    env: { DEV_OPS_TOKEN: API_TOKEN },
    stdout: () => undefined,
    stderr: () => undefined,
    readStdin: async () => '',
  }
  const program = new Command()
  program.command('project').description('管理项目')
  registerCodeCommands(program, context)
  const projectGroups = program.commands.filter((command) => command.name() === 'project')
  assert.equal(projectGroups.length, 1)
  const subcommandNames = projectGroups[0]?.commands.map((command) => command.name()) ?? []
  assert.equal(subcommandNames.includes('repository'), true)
  assert.equal(subcommandNames.includes('code-reference'), true)
})

test('code 组、commit 与 PR 命令输出生成契约结构', async (t) => {
  const commit = {
    sha: 'a'.repeat(40),
    title: 'feat: demo',
    authorName: '测试用户',
    committedAt: '2026-11-11T00:00:00.000Z',
    url: 'https://github.com/example/repo/commit/' + 'a'.repeat(40),
    lastCheckedAt: '2026-11-11T00:00:00.000Z',
  }
  const pullRequest = {
    number: 12,
    title: 'feat: demo PR',
    authorName: '测试用户',
    sourceBranch: 'feature/demo',
    targetBranch: 'main',
    state: 'open',
    reviewStatus: 'pending',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    mergedAt: null,
    url: 'https://github.com/example/repo/pull/12',
    lastCheckedAt: '2026-11-11T00:00:00.000Z',
    files: [],
    truncated: false,
  }
  const { server, requests } = await startJsonStub(t, (request) => {
    const url = new URL(request.path, 'http://127.0.0.1')
    if (url.pathname.endsWith('/commits')) return successEnvelope({ items: [commit], page: 1, pageSize: 20, total: 1 })
    if (url.pathname.endsWith('/commits/' + commit.sha))
      return successEnvelope({ ...commit, files: [], filesTruncated: false, filesUnsupported: false })
    if (url.pathname.endsWith('/pull-requests'))
      return successEnvelope({ items: [pullRequest], page: 1, pageSize: 20, total: 1 })
    if (url.pathname.endsWith('/pull-requests/12')) return successEnvelope(pullRequest)
    if (url.pathname.endsWith('/pull-requests/12/diff'))
      return successEnvelope({ patch: 'diff --git a/x b/x', truncated: false })
    if (url.pathname.endsWith('/branches')) return successEnvelope({ branches: ['main'] })
    return failureEnvelope('NOT_FOUND', '未预期的请求')
  })

  const commits = await execute([
    'project',
    'repository',
    'commits',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--ref',
    'main',
    '--server',
    server,
    '--json',
  ])
  assert.equal(commits.code, 0, commits.stderr)
  assert.equal(JSON.parse(commits.stdout).data.items[0].sha, commit.sha)

  const commitDetail = await execute([
    'project',
    'repository',
    'commit',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--ref',
    commit.sha,
    '--server',
    server,
    '--json',
  ])
  assert.equal(commitDetail.code, 0, commitDetail.stderr)
  assert.equal(JSON.parse(commitDetail.stdout).data.title, 'feat: demo')

  const prs = await execute([
    'project',
    'repository',
    'pull-requests',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--state',
    'open',
    '--server',
    server,
    '--json',
  ])
  assert.equal(prs.code, 0, prs.stderr)
  assert.equal(JSON.parse(prs.stdout).data.items[0].number, 12)

  const pr = await execute([
    'project',
    'repository',
    'pull-request',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--number',
    '12',
    '--server',
    server,
    '--json',
  ])
  assert.equal(pr.code, 0, pr.stderr)
  assert.equal(JSON.parse(pr.stdout).data.number, 12)

  const diff = await execute([
    'project',
    'repository',
    'pull-request-diff',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--number',
    '12',
    '--server',
    server,
    '--json',
  ])
  assert.equal(diff.code, 0, diff.stderr)
  assert.equal(JSON.parse(diff.stdout).data.truncated, false)

  const shortBranches = await execute([
    'code',
    'branches',
    PROJECT_ID,
    '--repository',
    REPOSITORY_ID,
    '--server',
    server,
    '--json',
  ])
  assert.equal(shortBranches.code, 0, shortBranches.stderr)
  assert.deepEqual(JSON.parse(shortBranches.stdout).data.branches, ['main'])
  assert.equal(requests.length, 6)
})
