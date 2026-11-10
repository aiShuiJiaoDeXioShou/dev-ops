import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'
import { startStubServer, successEnvelope } from './support/stub-server.ts'

async function execute(args: string[], input = '', env: NodeJS.ProcessEnv = {}) {
  let stdout = ''
  let stderr = ''
  const code = await runCli(args, {
    version: '1.2.3',
    env,
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => input,
  })
  return { code, stdout, stderr }
}

async function withConfigDir(run: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'devops-cli-delivery-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = directory
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(directory, { recursive: true, force: true })
  }
}

const buildFixture = {
  id: 'build-1',
  projectId: 'project-1',
  serviceId: null,
  environment: 'test',
  buildKey: 'ci-100',
  versionLabel: '1.0.0',
  commitRef: 'abc1234',
  source: 'pipeline',
  sourceRunId: 'run-1',
  collectedAt: '2026-11-10T08:00:00.000Z',
  resultStatus: 'succeeded',
  note: '构建成功',
  artifacts: [],
  targets: [],
  corrections: [],
  version: 1,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
}

const reportBody = {
  environment: 'test',
  buildKey: 'ci-100',
  versionLabel: '1.0.0',
  source: 'pipeline',
  collectedAt: '2026-11-10T08:00:00.000Z',
  resultStatus: 'succeeded',
  note: '构建成功',
}

test('delivery report 使用 Bearer 与幂等键并输出 JSON 信封', async (t) => {
  await withConfigDir(async () => {
    let authorization = ''
    let idempotencyKey = ''
    let received = ''
    const server = await startStubServer(t, (request, response) => {
      authorization = String(request.headers.authorization ?? '')
      idempotencyKey = String(request.headers['idempotency-key'] ?? '')
      request.on('data', (chunk) => {
        received += String(chunk)
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(successEnvelope(buildFixture))
      })
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)

    const result = await execute(
      ['delivery', 'report', '--project', 'project-1', '--file', '-', '--idempotency-key', 'key-1', '--json'],
      JSON.stringify(reportBody),
    )
    assert.equal(result.code, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.success, true)
    assert.equal(payload.data.buildKey, 'ci-100')
    assert.equal(authorization.startsWith('Bearer devops_pat_'), true)
    assert.equal(idempotencyKey, 'key-1')
    assert.equal(JSON.parse(received).buildKey, 'ci-100')
  })
})

test('delivery report 拒绝非法 JSON 与缺少必填字段', async (t) => {
  await withConfigDir(async () => {
    const server = await startStubServer(t, (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(successEnvelope(buildFixture))
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)
    const invalid = await execute(['delivery', 'report', '--project', 'project-1', '--file', '-'], '{')
    assert.equal(invalid.code, 2)
    const missing = await execute(
      ['delivery', 'report', '--project', 'project-1', '--file', '-'],
      JSON.stringify({ versionLabel: '1.0.0' }),
    )
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /buildKey/)
  })
})

test('delivery list 与 get 读取 JSON 结果', async (t) => {
  await withConfigDir(async () => {
    const server = await startStubServer(t, (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/builds/build-1') {
        response.end(successEnvelope(buildFixture))
        return
      }
      response.end(successEnvelope({ items: [buildFixture], page: 1, pageSize: 20, total: 1 }))
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)
    const list = await execute(['delivery', 'list', '--project', 'project-1', '--json'])
    assert.equal(list.code, 0, list.stderr)
    assert.equal(JSON.parse(list.stdout).data.total, 1)
    const get = await execute(['delivery', 'get', 'build-1', '--json'])
    assert.equal(get.code, 0, get.stderr)
    assert.equal(JSON.parse(get.stdout).data.id, 'build-1')
  })
})
