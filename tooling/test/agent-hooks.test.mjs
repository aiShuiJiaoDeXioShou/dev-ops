import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { editedPaths, runsGitSubcommand, touchesRepository } from '../agent-hooks/devops-hook.mjs'

const hook = fileURLToPath(new URL('../agent-hooks/devops-hook.mjs', import.meta.url))

/** 假 CLI：按环境变量返回 work status / work link 的结果，并把调用参数追加到日志文件。 */
const FAKE_CLI = `
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\\n')
if (process.env.FAKE_FAIL === '1') {
  process.stderr.write(JSON.stringify({ success: false, code: 'NETWORK_ERROR', message: '服务不可达' }))
  process.exit(1)
}
const data = args[1] === 'link' ? { ref: 'REQ-7', linked: ['abc1234'], localOnly: [] } : JSON.parse(process.env.FAKE_STATUS)
process.stdout.write(JSON.stringify({ success: true, code: 'OK', message: 'OK', requestId: 'local', data }))
`

const TRACKED = {
  binding: 'tracked',
  item: { ref: 'REQ-7', title: '登录页', status: 'in_development' },
  tasks: { total: 2, done: 1, open: [{ id: 't2', title: '前端' }] },
  gaps: [
    { code: 'UNREPORTED_COMMITS', blocking: true, message: '有新提交尚未回写到 REQ-7' },
    { code: 'OPEN_TASKS', blocking: false, message: '未完成待办：t2 前端' },
  ],
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'devops-hook-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repo = join(directory, 'repo')
  execFileSync('git', ['init', '-q', repo])
  const cli = join(directory, 'fake-cli.mjs')
  await writeFile(cli, FAKE_CLI)
  const log = join(directory, 'calls.log')
  await writeFile(log, '')
  /** 运行 hook 并解析 stdout；没有输出表示放行。 */
  const run = (event, payload, status, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [hook, event], {
      input: JSON.stringify({ cwd: repo, ...payload }),
      encoding: 'utf8',
      env: {
        ...process.env,
        DEVOPS_HOOK_CLI: cli,
        FAKE_LOG: log,
        FAKE_STATUS: JSON.stringify(status),
        ...extraEnv,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim() ? JSON.parse(result.stdout) : null
  }
  const calls = () => execFileSync('cat', [log], { encoding: 'utf8' })
  return { directory, repo, run, calls }
}

test('pre-edit 未绑定事项时拒绝修改仓库文件，并只读取本地绑定', async (t) => {
  const { repo, run, calls } = await setup(t)
  const output = run(
    'pre-edit',
    { tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.ts') } },
    { binding: 'none', gaps: [] },
  )
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /devops work start/)
  assert.match(calls(), /work status --local --json/)
})

test('pre-edit 放行仓库外文件、已绑定或已声明无需事项的工作区', async (t) => {
  const { directory, repo, run } = await setup(t)
  const outside = { tool_name: 'Write', tool_input: { file_path: join(directory, 'scratch.md') } }
  assert.equal(run('pre-edit', outside, { binding: 'none', gaps: [] }), null)
  const inside = { tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.ts') } }
  assert.equal(run('pre-edit', inside, TRACKED), null)
  assert.equal(run('pre-edit', inside, { binding: 'untracked', reason: '咨询', gaps: [] }), null)
})

test('pre-edit 解析 Codex apply_patch 补丁头中的文件路径', async (t) => {
  const { run } = await setup(t)
  const patch = '*** Begin Patch\n*** Update File: apps/web/src/main.tsx\n@@\n-a\n+b\n*** End Patch'
  const output = run(
    'pre-edit',
    { tool_name: 'apply_patch', tool_input: { command: patch } },
    { binding: 'none', gaps: [] },
  )
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny')
})

test('pre-edit 在 CLI 失败时放行并提示无法检查', async (t) => {
  const { repo, run } = await setup(t)
  const output = run('pre-edit', { tool_input: { file_path: join(repo, 'a.ts') } }, TRACKED, { FAKE_FAIL: '1' })
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined)
  assert.match(output.hookSpecificOutput.additionalContext, /服务不可达/)
})

test('stop 存在阻塞缺项时要求继续一次，已继续过则放行', async (t) => {
  const { run } = await setup(t)
  const output = run('stop', { stop_hook_active: false }, TRACKED)
  assert.equal(output.decision, 'block')
  assert.match(output.reason, /有新提交尚未回写到 REQ-7/)
  assert.doesNotMatch(output.reason, /未完成待办/, '非阻塞提示不应阻止结束')
  assert.equal(run('stop', { stop_hook_active: true }, TRACKED), null)
  assert.equal(run('stop', {}, { ...TRACKED, gaps: [] }), null)
  assert.equal(run('stop', {}, { binding: 'none', gaps: [] }), null)
})

test('post-bash 在 git push 后自动关联提交，在 git commit 后提醒勾选待办', async (t) => {
  const { run, calls } = await setup(t)
  const pushed = run('post-bash', { tool_input: { command: 'git push origin main' } }, TRACKED)
  assert.match(pushed.hookSpecificOutput.additionalContext, /abc1234/)
  assert.match(calls(), /work link --json/)
  const committed = run('post-bash', { tool_input: { command: 'git add . && git commit -m "x"' } }, TRACKED)
  assert.match(committed.hookSpecificOutput.additionalContext, /work task done/)
  assert.equal(run('post-bash', { tool_input: { command: 'pnpm test' } }, TRACKED), null)
})

test('session-start 注入事项摘要；DEVOPS_HOOKS_DISABLED 时完全跳过', async (t) => {
  const { run } = await setup(t)
  const output = run('session-start', { source: 'startup' }, TRACKED)
  assert.match(output.hookSpecificOutput.additionalContext, /REQ-7 登录页/)
  assert.equal(run('session-start', {}, TRACKED, { DEVOPS_HOOKS_DISABLED: '1' }), null)
})

test('editedPaths 与 touchesRepository 识别编辑目标', () => {
  assert.deepEqual(editedPaths({ file_path: '/repo/a.ts' }), ['/repo/a.ts'])
  assert.deepEqual(editedPaths({ command: '*** Add File: docs/x.md\n*** Delete File: y.ts' }), ['docs/x.md', 'y.ts'])
  assert.equal(touchesRepository(['/tmp/x'], '/repo', '/repo'), false)
  assert.equal(touchesRepository(['src/a.ts'], '/repo', '/repo'), true)
  assert.equal(touchesRepository([], '/repo', '/repo'), true)
})

test('runsGitSubcommand 只识别命令段开头的 git 子命令', () => {
  assert.equal(runsGitSubcommand('git commit -m "x"', 'commit'), true)
  assert.equal(runsGitSubcommand('pnpm format && git -C repo push origin main', 'push'), true)
  assert.equal(runsGitSubcommand('git add .\ngit commit -m x', 'commit'), true)
  assert.equal(runsGitSubcommand('devops work log "git commit 后提醒"', 'commit'), false)
  assert.equal(runsGitSubcommand('git log --oneline', 'commit'), false)
})
