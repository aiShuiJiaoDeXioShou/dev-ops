import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'
import { startStubServer, successEnvelope } from './support/stub-server.ts'

async function execute(args: string[], env: NodeJS.ProcessEnv = {}) {
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
    readStdin: async () => '',
  })
  return { code, stdout, stderr }
}

const TOKEN = 'devops_pat_abcdefghijklmnopqrstuvwxyz012345'

test('无 TTY 危险操作缺少 --yes 退出 2 且不发送请求', async (t) => {
  let requests = 0
  const server = await startStubServer(t, (_request, response) => {
    requests += 1
    response.end(successEnvelope({}))
  })
  const env = { DEV_OPS_TOKEN: TOKEN, DEV_OPS_SERVER: server }
  for (const args of [
    ['project', 'repository', 'remove', 'p1', '--repository', 'r1', '--reason', '清理'],
    ['requirement', 'cancel', 'req-1', '--reason', '取消'],
    ['bug', 'close', 'bug-1', '--category', 'not_bug', '--note', '非缺陷'],
    ['team', 'member', 'update', 'user-1', '--status', 'disabled'],
  ]) {
    const result = await execute(args, env)
    assert.equal(result.code, 2, JSON.stringify(args))
    assert.equal(result.stdout, '')
  }
  assert.equal(requests, 0)
})

test('无 Token 的业务命令退出 1 且不发起请求', async () => {
  const result = await execute(['team', 'list', '--json'], { DEV_OPS_SERVER: 'http://127.0.0.1:1' })
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  const payload = JSON.parse(result.stderr)
  assert.equal(payload.success, false)
  assert.equal(payload.code, 'TOKEN_REQUIRED')
})

test('login/token 等已删除命令按未知命令退出 2', async () => {
  for (const args of [['login'], ['logout'], ['token', 'create']]) {
    const result = await execute(args)
    assert.equal(result.code, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /未知命令|参数/)
  }
})
