import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import { test, type TestContext } from 'node:test'
import { runCli } from '../src/cli.ts'

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
  })
  return { code, stdout, stderr }
}

async function startServer(t: TestContext, listener: RequestListener) {
  const server = createServer(listener)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

test('无参数和帮助命令可在服务配置无效时正常使用', async () => {
  for (const args of [[], ['--help'], ['health', '-h']]) {
    const result = await execute(args, { DEV_OPS_SERVER: 'invalid' })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /dev-ops health/)
    assert.equal(result.stderr, '')
  }
})

test('命令入口输出包版本，参数错误使用退出码 2 和标准错误流', () => {
  const cwd = new URL('../', import.meta.url)
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const version = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', '--version'], {
    cwd,
    encoding: 'utf8',
  })
  assert.equal(version.status, 0)
  assert.equal(version.stdout.trim(), metadata.version)
  assert.equal(version.stderr, '')
  const invalid = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', 'unknown'], { cwd, encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stdout, '')
  assert.match(invalid.stderr, /未知命令/)
})

test('未知选项、无效地址与非法超时在请求前被拒绝', async () => {
  for (const args of [
    ['--unknown'],
    ['--server'],
    ['--json'],
    ['health', 'extra'],
    ['health', '--server', 'invalid'],
    ['health', '--server', 'file:///tmp/test'],
    ['health', '--server', 'http://user:secret@localhost'],
    ['health', '--server', 'http://localhost?token=secret'],
    ...['0', '-1', '1.5', 'Infinity', '300001', ''].map((timeout) => ['health', '--timeout', timeout]),
  ]) {
    const result = await execute(args)
    assert.equal(result.code, 2, JSON.stringify(args))
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^错误：/)
    assert.equal(result.stderr.includes('secret'), false)
  }
})

test('健康检查保留代理路径，参数覆盖环境配置且 JSON 不透传额外字段', async (t) => {
  const server = await startServer(t, (request, response) => {
    assert.equal(request.url, '/proxy/api/v1/health')
    assert.equal(request.headers.accept, 'application/json')
    response.end(
      JSON.stringify({
        success: true,
        code: 'OK',
        message: 'OK',
        requestId: 'trace',
        data: { status: 'ok', internal: 'private' },
      }),
    )
  })
  const result = await execute(['health', '--server', `${server}/proxy/`, '--json'], { DEV_OPS_SERVER: 'invalid' })
  assert.equal(result.code, 0)
  assert.deepEqual(JSON.parse(result.stdout), { status: 'ok' })
  assert.equal(result.stderr, '')
})

test('健康检查支持环境变量配置和文本输出', async (t) => {
  const server = await startServer(t, (_request, response) => {
    response.end('{"success":true,"code":"OK","message":"OK","requestId":"trace","data":{"status":"ok"}}')
  })
  const result = await execute(['health'], { DEV_OPS_SERVER: server })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /后端运行正常/)
  assert.equal(result.stderr, '')
})

test('HTTP 错误、非法 JSON 和不匹配的响应不能被报告为健康', async (t) => {
  for (const [status, body, expected] of [
    [503, 'secret', /HTTP 503/],
    [200, '<html>secret</html>', /有效 JSON/],
    [200, '{"status":"down"}', /契约/],
    [200, 'null', /契约/],
  ] as const) {
    const server = await startServer(t, (_request, response) => {
      response.writeHead(status)
      response.end(body)
    })
    const result = await execute(['health', '--server', server, '--json'])
    assert.equal(result.code, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, expected)
    assert.equal(result.stderr.includes('secret'), false)
  }
})

test('超时覆盖响应头等待和响应体读取', async (t) => {
  for (const sendHeaders of [false, true]) {
    const server = await startServer(t, (_request, response) => {
      if (sendHeaders) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{')
      }
    })
    const result = await execute(['health', '--server', server, '--timeout', '50'])
    assert.equal(result.code, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /超时/)
  }
})

test('连接中断返回可读错误而不泄露内部堆栈', async (t) => {
  const server = await startServer(t, (request) => {
    request.socket.destroy()
  })
  const result = await execute(['health', '--server', server])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /无法连接后端/)
  assert.equal(result.stderr.includes(' at '), false)
})
