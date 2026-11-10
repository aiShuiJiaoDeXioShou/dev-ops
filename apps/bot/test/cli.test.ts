import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))

test('帮助不依赖配置、非法参数退出码为 2，模型缺少密钥安全退出', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-cli-'))
  const environment = { ...process.env, DEEPSEEK_API_KEY: '', BOT_DATABASE_PATH: join(directory, 'bot.sqlite') }
  function run(args: string[], env: NodeJS.ProcessEnv = environment) {
    return spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], { encoding: 'utf8', env })
  }
  try {
    assert.equal(run(['--help'], { ...environment, BOT_TIMEOUT_MS: 'invalid' }).status, 0)
    assert.equal(run(['--invalid']).status, 2)
    assert.equal(run(['chat', '--json']).status, 2)
    assert.equal(run(['chat', '']).status, 2)
    const failed = run(['chat', '你好', '--json'])
    assert.equal(failed.status, 1)
    assert.equal(failed.stdout, '')
    assert.match(failed.stderr, /DEEPSEEK_API_KEY/u)
    assert.equal(run(['memory', 'remember', '偏好中文']).status, 0)
    const listed = run(['memory', 'list', '--json'])
    assert.equal(listed.status, 0)
    assert.match(listed.stdout, /偏好中文/u)
    assert.ok(Array.isArray(JSON.parse(listed.stdout)))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
