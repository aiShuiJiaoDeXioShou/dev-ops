import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('Agent 开发入口加载 .env，并等待就绪信封成功才启动', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pipeline-agent-dev-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))

  const requests: Array<string | undefined> = []
  const platform = createServer((request, response) => {
    requests.push(request.url)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ success: requests.length > 1 }))
  })
  platform.listen(0, '127.0.0.1')
  await once(platform, 'listening')
  t.after(() => new Promise<void>((resolve) => platform.close(() => resolve())))
  const address = platform.address()
  assert.ok(address && typeof address === 'object')

  await writeFile(
    join(cwd, '.env'),
    [
      `PLATFORM_URL=http://127.0.0.1:${address.port}`,
      'AGENT_TOKEN=fixture-token',
      `AGENT_WORK_DIR=${cwd}`,
      `AGENT_DOCKER_SOCKET=${join(cwd, 'missing.sock')}`,
    ].join('\n'),
  )
  const entry = fileURLToPath(new URL('../scripts/dev.mjs', import.meta.url))
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      ['--env-file-if-exists=.env', '--import', import.meta.resolve('tsx'), entry],
      {
        cwd,
        env: { PATH: process.env.PATH },
        timeout: 15_000,
      },
    ),
    // 使用不存在的 socket 停在进入真实 Agent 后的第一步，避免触碰宿主机 Docker。
    { code: 1, stderr: /运行失败.*missing\.sock/ },
  )
  assert.deepEqual(requests, ['/api/v1/ready', '/api/v1/ready'])
})
