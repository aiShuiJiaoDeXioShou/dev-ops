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
  const directory = await mkdtemp(join(tmpdir(), 'devops-cli-change-'))
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
  status: 'pending',
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
  approvedRevision: null,
  activeExecutionId: null,
  startedAt: null,
  completedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: null,
  createdAt: '2026-11-11T02:00:00.000Z',
  updatedAt: '2026-11-11T02:00:00.000Z',
  version: 1,
}

test('change create 发送固定计划字段与幂等键', async (t) => {
  await withConfigDir(async () => {
    let receivedBody = ''
    let idempotencyKey = ''
    const server = await startStubServer(t, (request, response) => {
      idempotencyKey = String(request.headers['idempotency-key'] ?? '')
      request.on('data', (chunk) => {
        receivedBody += String(chunk)
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(
          successEnvelope({
            plan: planFixture,
            approval: null,
            executions: [],
            events: [],
            actions: {
              canUpdate: true,
              canApprove: false,
              canExecute: false,
              canVerify: false,
              canCancel: true,
              canRetry: false,
            },
          }),
        )
      })
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)

    const result = await execute([
      'change',
      'create',
      '--project',
      '22222222-2222-4222-8222-222222222222',
      '--kind',
      'deploy_version',
      '--environment',
      'test',
      '--service',
      '33333333-3333-4333-8333-333333333333',
      '--target',
      'web',
      '--version-label',
      'v1.4.0',
      '--scope',
      '部署测试环境',
      '--evidence',
      '流水线通过',
      '--rollback',
      '回滚上一版本',
      '--execution',
      'platform_pipeline',
      '--workflow',
      '.devops/workflows/deploy-test.yml',
      '--workflow-ref',
      'main',
      '--idempotency-key',
      'change-key-1',
      '--json',
    ])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(idempotencyKey, 'change-key-1')
    const body = JSON.parse(receivedBody) as Record<string, unknown>
    assert.equal(body.operationKind, 'deploy_version')
    assert.equal(body.workflowPath, '.devops/workflows/deploy-test.yml')
    assert.equal(body.versionLabel, 'v1.4.0')
  })
})

test('change show 输出计划详情', async (t) => {
  await withConfigDir(async () => {
    const server = await startStubServer(t, (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        successEnvelope({
          plan: planFixture,
          approval: null,
          executions: [],
          events: [],
          actions: {
            canUpdate: true,
            canApprove: false,
            canExecute: false,
            canVerify: false,
            canCancel: true,
            canRetry: false,
          },
        }),
      )
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)

    const result = await execute(['change', 'show', planFixture.id, '--json'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /v1\.4\.0/)
  })
})
