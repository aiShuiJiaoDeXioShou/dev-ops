import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { runCli } from '../src/cli.ts'
import { startStubServer, successEnvelope } from './support/stub-server.ts'

const teamId = '2080f0ec-aed8-42f3-81d3-c51b858be074'
const personalToken = 'devops_pat_cli_fixture'

async function execute(server: string, args: string[], input?: unknown) {
  let stdout = ''
  let stderr = ''
  const code = await runCli([...args, '--json'], {
    version: '0.8.0',
    env: { DEV_OPS_SERVER: server, DEV_OPS_TOKEN: personalToken, DEV_OPS_TEAM: teamId },
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => JSON.stringify(input),
  })
  return { code, stdout, stderr }
}

async function temporaryDirectory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'devops-cli-test-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('历史任务仅保留只读命令，写命令在发出请求前拒绝', async (t) => {
  let requests = 0
  const server = await startStubServer(t, (_req, res) => {
    requests += 1
    res.end(successEnvelope({}))
  })
  for (const command of ['create', 'append', 'handoff', 'rerun', 'cancel', 'stop', 'accept', 'request-changes']) {
    const result = await execute(server, ['task', command, randomUUID()])
    assert.equal(result.code, 2, command)
    assert.equal(result.stdout, '')
  }
  assert.equal(requests, 0)
})

test('游标列表保持服务端游标语义并按 --all 读取后续页', async (t) => {
  const first = randomUUID()
  const second = randomUUID()
  const server = await startStubServer(t, (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const next = url.searchParams.get('cursor')
    res.setHeader('content-type', 'application/json')
    res.end(
      successEnvelope(
        next === first ? { items: [{ id: second }], nextCursor: null } : { items: [{ id: first }], nextCursor: first },
      ),
    )
  })
  const result = await execute(server, ['conversation', 'list', '--all'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).data, { items: [{ id: first }, { id: second }], nextCursor: null })
})

test('下载校验失败清除临时数据，成功也不会覆盖已有文件', async (t) => {
  const directory = await temporaryDirectory(t)
  const output = join(directory, 'artifact.tar')
  const payload = '测试产物'
  let checksum = '1'.repeat(64)
  const server = await startStubServer(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${personalToken}`)
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('x-content-sha256', checksum)
    res.end(payload)
  })
  const args = ['pipeline', 'artifact', 'download', randomUUID(), '--output', output]
  const failure = await execute(server, args)
  assert.equal(failure.code, 1)
  assert.equal(JSON.parse(failure.stderr).code, 'CHECKSUM_MISMATCH')
  assert.deepEqual(await readdir(directory), [])
  checksum = createHash('sha256').update(payload).digest('hex')
  const success = await execute(server, args)
  assert.equal(success.code, 0, success.stderr)
  assert.equal(await readFile(output, 'utf8'), payload)
  await writeFile(output, '现有文件')
  assert.equal((await execute(server, args)).code, 2)
  assert.equal(await readFile(output, 'utf8'), '现有文件')
  assert.deepEqual(await readdir(directory), ['artifact.tar'])
})

test('节点令牌轮换要求确认，新令牌只出现在权限为 0600 的文件中', async (t) => {
  const directory = await temporaryDirectory(t)
  const tokenOut = join(directory, 'node-token')
  const nodeId = randomUUID()
  const agentToken = 'pipeline_agent_fixture'
  let requests = 0
  const server = await startStubServer(t, (_req, res) => {
    requests += 1
    res.setHeader('content-type', 'application/json')
    res.end(successEnvelope({ nodeId, agentToken }))
  })
  const args = ['pipeline', 'node', 'rotate-token', nodeId, '--token-out', tokenOut]
  const refused = await execute(server, args)
  assert.equal(refused.code, 2)
  assert.equal(JSON.parse(refused.stderr).code, 'CONFIRMATION_REQUIRED')
  assert.equal(requests, 0)
  const success = await execute(server, [...args, '--yes'])
  assert.equal(success.code, 0, success.stderr)
  assert.equal(await readFile(tokenOut, 'utf8'), `${agentToken}\n`)
  if (process.platform !== 'win32') assert.equal((await stat(tokenOut)).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(success.stdout).data, { nodeId })
  assert.doesNotMatch(success.stdout, /pipeline_agent_fixture/)
  assert.equal((await execute(server, [...args, '--yes'])).code, 2)
  assert.equal(requests, 1)
})

test('运行等待区分失败终态和本地超时', async (t) => {
  let status = 'running'
  const server = await startStubServer(t, (_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(successEnvelope({ status, errorCode: 'RUN_FAILED', errorMessage: '运行失败' }))
  })
  const args = ['pipeline', 'run', 'wait', randomUUID(), '--wait-timeout', '80']
  assert.equal(JSON.parse((await execute(server, args)).stderr).code, 'WAIT_TIMEOUT')
  status = 'failed'
  const failure = await execute(server, ['pipeline', 'run', 'wait', randomUUID()])
  assert.equal(failure.code, 1)
  assert.equal(JSON.parse(failure.stderr).code, 'RUN_FAILED')
})
