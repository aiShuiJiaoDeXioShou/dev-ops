import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
  const directory = await mkdtemp(join(tmpdir(), 'devops-cli-tool-'))
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

const projectId = '22222222-2222-4222-8222-222222222222'
const repositoryId = '33333333-3333-4333-8333-333333333333'
const codeChangeId = '66666666-6666-4666-8666-666666666666'

const codeChangeFixture = {
  id: codeChangeId,
  projectId,
  repository: { id: repositoryId, name: 'team/dev-ops' },
  baseRef: 'main',
  baseSha: 'a7c92e1',
  branchName: 'feature/demo',
  commitMessage: '演示',
  patchSha256: 'x'.repeat(64),
  patchSizeBytes: 20,
  validationWorkflowPath: '.devops/workflows/validate.yml',
  status: 'queued',
  pipelineRunId: null,
  validation: null,
  pullRequest: null,
  diff: null,
  errorCode: null,
  errorMessage: null,
  createdBy: null,
  createdAt: '2026-11-11T02:00:00.000Z',
  finishedAt: null,
}

test('tool code-change create 计算补丁摘要并提交幂等键', async (t) => {
  await withConfigDir(async () => {
    let body = ''
    let idempotencyKey = ''
    const server = await startStubServer(t, (request, response) => {
      idempotencyKey = String(request.headers['idempotency-key'] ?? '')
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(successEnvelope({ codeChange: codeChangeFixture, invocationId: codeChangeId }))
      })
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)
    const patch = 'diff --git a/a.ts b/a.ts\n+const a = 1\n'
    const result = await execute(
      [
        'tool',
        'code-change',
        'create',
        '--project',
        projectId,
        '--repository',
        repositoryId,
        '--base',
        'main',
        '--branch',
        'feature/demo',
        '--message',
        '演示',
        '--patch-file',
        '-',
        '--validation-workflow',
        '.devops/workflows/validate.yml',
        '--idempotency-key',
        'tool-key-1',
        '--json',
      ],
      patch,
    )
    assert.equal(result.code, 0, result.stderr)
    assert.equal(idempotencyKey, 'tool-key-1')
    const parsed = JSON.parse(body) as Record<string, unknown>
    assert.equal(parsed.patch, patch)
    assert.equal(parsed.patchSha256, createHash('sha256').update(patch, 'utf8').digest('hex'))
  })
})

test('tool pr create 为代码变更创建 PR', async (t) => {
  await withConfigDir(async () => {
    let body = ''
    const server = await startStubServer(t, (request, response) => {
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(
          successEnvelope({
            invocationId: codeChangeId,
            pullRequest: {
              number: 42,
              url: 'https://example.test/pr/42',
              sourceBranch: 'feature/demo',
              targetBranch: 'main',
            },
          }),
        )
      })
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)
    const result = await execute([
      'tool',
      'pr',
      codeChangeId,
      '--title',
      '演示 PR',
      '--idempotency-key',
      'tool-key-2',
      '--json',
    ])
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(JSON.parse(body), { title: '演示 PR', body: '' })
  })
})
