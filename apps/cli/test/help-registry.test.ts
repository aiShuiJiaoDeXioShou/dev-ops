import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('README 中的命令组与帮助注册表一致', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const help = await execute(['--help'])
  assert.equal(help.code, 0)
  const groups = new Set(
    [...readme.matchAll(/^devops\s+([a-z][a-z-]*)/gm)].map((match) => match[1] ?? '').filter(Boolean),
  )
  for (const group of groups) {
    assert.ok(group === 'help' || help.stdout.includes(group), `README 命令组 ${group} 未在帮助中注册`)
  }
})
