import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'

async function execute(args: string[]) {
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
  })
  return { code, stdout, stderr }
}

test('帮助离线覆盖核心命令组', async () => {
  const result = await execute(['--help'])
  assert.equal(result.code, 0)
  for (const command of ['config', 'health', 'ready', 'whoami', 'project', 'team', 'git', 'requirement', 'bug']) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`))
  }
  assert.equal(result.stderr, '')
})

test('子命令帮助离线可用且未知命令退出 2', async () => {
  const help = await execute(['requirement', '--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /submit-test/)
  const unknown = await execute(['unknown-command'])
  assert.equal(unknown.code, 2)
  assert.equal(unknown.stdout, '')
})
