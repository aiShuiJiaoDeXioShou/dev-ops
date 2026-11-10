import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'
import { startStubServer, successEnvelope } from './support/stub-server.ts'

const TOKEN = 'devops_pat_abcdefghijklmnopqrstuvwxyz012345'

async function execute(args: string[], env: NodeJS.ProcessEnv = {}, stdin = '') {
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
    readStdin: async () => stdin,
  })
  return { code, stdout, stderr }
}

test('Token 不出现在输出与错误中，Token argv 被拒绝', async (t) => {
  const server = await startStubServer(t, (_request, response) => {
    response.end(successEnvelope({ user: { id: 'u1', name: '测试', email: 'u@example.test' }, teams: [] }))
  })
  const env = { DEV_OPS_TOKEN: TOKEN, DEV_OPS_SERVER: server }
  const ok = await execute(['whoami', '--json'], env)
  assert.equal(ok.code, 0)
  assert.equal(ok.stdout.includes(TOKEN), false)
  assert.equal(ok.stderr.includes(TOKEN), false)

  const argv = await execute(['whoami', '--token', TOKEN], env)
  assert.equal(argv.code, 2)
  assert.equal(argv.stdout.includes(TOKEN), false)
  assert.equal(argv.stderr.includes(TOKEN), false)
})

test('坏响应按 INVALID_RESPONSE 失败关闭', async (t) => {
  const server = await startStubServer(t, (_request, response) => {
    response.end(JSON.stringify({ success: true, code: 'OK', message: 'ok', requestId: 'trace' }))
  })
  const result = await execute(['team', 'list', '--json'], {
    DEV_OPS_TOKEN: TOKEN,
    DEV_OPS_SERVER: server,
  })
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /INVALID_RESPONSE|契约/)
})

test('请求超时按运行失败退出 1', async (t) => {
  const server = await startStubServer(t, () => {
    // 故意不响应，等待 CLI 超时。
  })
  const started = Date.now()
  const result = await execute(['whoami', '--timeout', '50'], {
    DEV_OPS_TOKEN: TOKEN,
    DEV_OPS_SERVER: server,
  })
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /超时|TIMEOUT/)
  assert.ok(Date.now() - started < 2_000)
})
