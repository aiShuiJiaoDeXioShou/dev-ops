import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'
import { configFilePath } from '../src/lib/config-file.ts'
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
  const directory = await mkdtemp(join(tmpdir(), 'devops-cli-test-'))
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

test('config 保存 server/token、限制权限并掩码显示', async () => {
  await withConfigDir(async () => {
    const server = 'http://127.0.0.1:3001'
    const setServer = await execute(['config', 'set', 'server', server, '--json'])
    assert.equal(setServer.code, 0, setServer.stderr)
    const file = configFilePath()
    const fileStat = await stat(file)
    assert.equal(fileStat.mode & 0o777, 0o600)
    const fileDirectory = await stat(join(file, '..'))
    assert.equal(fileDirectory.mode & 0o777, 0o700)

    const token = 'devops_pat_abcdefghijklmnopqrstuvwxyz012345'
    const setToken = await execute(['config', 'set', 'token', '--json'], token)
    assert.equal(setToken.code, 0, setToken.stderr)
    assert.equal(setToken.stdout.includes(token), false)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.server, server)
    assert.equal(saved.token, token)

    const get = await execute(['config', 'get', 'token', '--json'])
    assert.equal(get.code, 0)
    const payload = JSON.parse(get.stdout)
    assert.equal(payload.data.token.includes(token), false)
    assert.equal(payload.data.token.includes('…'), true)
  })
})

test('whoami 使用本地 Token 并发送 Bearer；无 Token 失败', async (t) => {
  await withConfigDir(async () => {
    let authorization = ''
    const server = await startStubServer(t, (request, response) => {
      authorization = String(request.headers.authorization ?? '')
      response.end(
        successEnvelope({
          user: { id: 'user-1', name: '测试用户', email: 'user@example.test' },
          teams: [{ id: 'team-1', name: '测试团队', role: 'admin', status: 'active' }],
        }),
      )
    })
    assert.equal((await execute(['config', 'set', 'server', server])).code, 0)
    assert.equal((await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')).code, 0)
    const whoami = await execute(['whoami', '--json'])
    assert.equal(whoami.code, 0, whoami.stderr)
    assert.equal(authorization, 'Bearer devops_pat_abcdefghijklmnopqrstuvwxyz012345')
    const payload = JSON.parse(whoami.stdout)
    assert.equal(payload.success, true)
    assert.equal(payload.data.user.email, 'user@example.test')

    await execute(['config', 'unset', 'token'])
    const missing = await execute(['whoami', '--json'])
    assert.equal(missing.code, 1)
    assert.equal(JSON.parse(missing.stderr).code, 'TOKEN_REQUIRED')
  })
})

test('改 server 会清空旧 Token；Token argv 被拒绝', async () => {
  await withConfigDir(async () => {
    await execute(['config', 'set', 'server', 'http://127.0.0.1:3001'])
    await execute(['config', 'set', 'token'], 'devops_pat_abcdefghijklmnopqrstuvwxyz012345')
    await execute(['config', 'set', 'server', 'http://127.0.0.1:3002'])
    const get = await execute(['config', 'get', '--json'])
    const payload = JSON.parse(get.stdout)
    assert.equal(payload.data.token, null)

    const argvToken = await execute(['whoami', '--token', 'devops_pat_x'])
    assert.equal(argvToken.code, 2)
    assert.equal(argvToken.stdout, '')
  })
})
