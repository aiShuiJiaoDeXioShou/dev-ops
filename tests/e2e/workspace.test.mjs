import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify, stripVTControlCharacters } from 'node:util'
import { test } from 'node:test'
import { createHttpApp } from '../../apps/server/dist/bootstrap/create-http-app.js'
import { loadConfig } from '../../apps/server/dist/platform/config/env.js'
import { createApiClient, RequestError } from '../../packages/api-client/dist/index.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const execute = promisify(execFile)

test('真实 Server、Web 代理及编译后的 CLI 共用现有接口', { timeout: 30_000 }, async (t) => {
  const app = createHttpApp(loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DB_CONNECT_TIMEOUT_MS: '100',
    DATABASE_URL: 'postgresql://smoke@127.0.0.1:1/unavailable',
  }))
  t.after(() => app.close())
  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const client = createApiClient({ baseUrl: address })
  assert.equal((await client.health()).data.status, 'ok')
  await assert.rejects(client.ready(), error => error instanceof RequestError && error.status === 503 && error.responseValid)

  const cli = await execute(process.execPath, ['apps/cli/dist/index.js', 'health', '--server', address, '--json'], { cwd: root })
  assert.deepEqual(JSON.parse(cli.stdout), { status: 'ok' })
  assert.equal(cli.stderr, '')

  const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url))
  const vite = join(dirname(requireWeb.resolve('vite/package.json')), 'bin/vite.js')
  const web = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '0'], {
    cwd: join(root, 'apps/web'),
    env: { ...process.env, DEV_OPS_API_TARGET: address, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(web, 'exit')
  t.after(async () => {
    web.kill('SIGTERM')
    const force = setTimeout(() => web.kill('SIGKILL'), 5_000)
    try { await exited } finally { clearTimeout(force) }
  })
  let output = ''
  let errors = ''
  web.stderr.on('data', chunk => { errors += chunk })
  const webAddress = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Web 启动超时：${errors}`)), 15_000)
    web.once('error', error => { clearTimeout(timeout); reject(error) })
    web.once('exit', () => { clearTimeout(timeout); reject(new Error(`Web 提前退出：${errors}`)) })
    web.stdout.on('data', chunk => {
      output += stripVTControlCharacters(String(chunk))
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//)
      if (match) { clearTimeout(timeout); resolve(match[0]) }
    })
  })
  const page = await fetch(new URL('system/status', webAddress))
  assert.equal(page.status, 200)
  assert.match(await page.text(), /id="root"/)
  const response = await fetch(new URL('api/v1/health', webAddress))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  const ready = await fetch(new URL('api/v1/ready', webAddress))
  assert.equal(ready.status, 503)
  assert.equal((await ready.json()).code, 'DATABASE_UNAVAILABLE')
})
