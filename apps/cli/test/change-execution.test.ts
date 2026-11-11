import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'
import { startStubServer, successEnvelope } from './support/stub-server.ts'

async function execute(args: string[], input = '') {
  let stdout = ''
  let stderr = ''
  const code = await runCli(args, {
    version: '1.2.3',
    env: {},
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
  const directory = await mkdtemp(join(tmpdir(), 'devops-cli-change-exec-'))
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

const planFixture = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  serviceId: '33333333-3333-4333-8333-333333333333',
  targetResource: 'web',
  environment: 'test',
  operationKind: 'deploy_version',
  status: 'executing',
  revision: 1,
  versionLabel: 'v1.4.0',
  scopeSummary: '部署测试环境',
  evidence: '流水线通过',
  rollbackPlan: '回滚上一版本',
  executionMode: 'platform_pipeline',
  workflowPath: '.devops/workflows/deploy-test.yml',
  workflowRef: 'main',
  approvedBy: null,
  approvedAt: null,
  approvedRevision: 1,
  activeExecutionId: '44444444-4444-4444-8444-444444444444',
  startedAt: '2026-11-11T02:05:00.000Z',
  completedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: null,
  createdAt: '2026-11-11T02:00:00.000Z',
  updatedAt: '2026-11-11T02:05:00.000Z',
  version: 2,
}

const executionFixture = {
  id: '44444444-4444-4444-8444-444444444444',
  attempt: 1,
  planRevision: 1,
  status: 'running',
  pipelineRunId: '55555555-5555-4555-8555-555555555555',
  startedAt: '2026-11-11T02:05:00.000Z',
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  verificationStatus: 'pending',
  healthStatus: null,
  expectedVersionLabel: 'v1.4.0',
  actualVersionLabel: null,
  verifiedBy: null,
  verifiedAt: null,
  verificationNote: null,
}

test('change execute 需要 --yes 并提交修订号', async (t) => {
  await withConfigDir(async () => {
    let receivedBody = ''
    const server = await startStubServer(t, (request, response) => {
      request.on('data', (chunk) => {
        receivedBody += String(chunk)
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(successEnvelope({ plan: planFixture, execution: executionFixture }))
      })
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)

    const withoutYes = await execute(['change', 'execute', planFixture.id, '--revision', '1', '--json'])
    assert.equal(withoutYes.code, 2)
    assert.match(withoutYes.stderr, /--yes/)

    const result = await execute(['change', 'execute', planFixture.id, '--revision', '1', '--yes', '--json'])
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(JSON.parse(receivedBody), { expectedRevision: 1 })
  })
})

test('change retry 需要核对原因并提交修订号', async (t) => {
  await withConfigDir(async () => {
    let receivedBody = ''
    const server = await startStubServer(t, (request, response) => {
      request.on('data', (chunk) => {
        receivedBody += String(chunk)
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(successEnvelope({ plan: planFixture, execution: executionFixture }))
      })
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)

    const result = await execute([
      'change',
      'retry',
      planFixture.id,
      '--revision',
      '1',
      '--reason',
      '已核对：上一次执行未生效',
      '--yes',
      '--json',
    ])
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(JSON.parse(receivedBody), { expectedRevision: 1, reason: '已核对：上一次执行未生效' })
  })
})
