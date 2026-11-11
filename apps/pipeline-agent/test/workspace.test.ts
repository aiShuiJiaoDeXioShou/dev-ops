import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { RunPlanGit } from '@dev-ops/pipeline-protocol'

import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { buildGitProcessEnv, cleanupStaleRunWorkspaces, createRunWorkspace } from '../src/workspace.ts'
import { createTestGitRepo } from './helpers/git-repo.ts'

const GIT_PASSWORD = 'super-secret-git-credential-value'

function createLoggerCapture(masker: ReturnType<typeof createSecretMasker>): {
  logger: ReturnType<typeof createAgentLogger>
  lines: string[]
} {
  const lines: string[] = []
  return { logger: createAgentLogger({ masker, write: (line) => lines.push(line) }), lines }
}

function gitInfo(remoteUrl: string, commitSha: string, overrides: Partial<RunPlanGit> = {}): RunPlanGit {
  return {
    remoteUrl,
    username: 'x-access-token',
    password: GIT_PASSWORD,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    commitSha,
    ...overrides,
  }
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const result: string[] = []
  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const target = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(target)))
    } else if (entry.isFile()) {
      result.push(target)
    }
  }
  return result
}

async function assertSecretNotOnDisk(rootDir: string, secret: string): Promise<void> {
  const needle = Buffer.from(secret, 'utf8')
  for (const file of await collectFiles(rootDir)) {
    const content = await readFile(file)
    assert.ok(!content.includes(needle), `敏感值不应写入磁盘：${file}`)
  }
}

test('使用短期凭据检出租约固定提交（不是远端 HEAD）', async () => {
  const repo = await createTestGitRepo()
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-workspace-'))
  const masker = createSecretMasker()
  const { logger } = createLoggerCapture(masker)
  try {
    const workspace = await createRunWorkspace({ workDir, runId: 'run-checkout-1', logger, masker })
    assert.ok((await stat(workspace.checkoutDir)).isDirectory())
    await workspace.ensureCheckout(gitInfo(repo.remoteUrl, repo.commitSha))
    const content = await readFile(join(workspace.checkoutDir, 'app.txt'), 'utf8')
    assert.equal(content, repo.firstContent, '必须检出固定提交的内容，而不是 HEAD')
    assert.ok(workspace.checkedOutCommit?.startsWith(repo.commitSha), '应记录已检出的提交')
    await assertSecretNotOnDisk(workspace.rootDir, GIT_PASSWORD)
    await workspace.remove()
    await assert.rejects(stat(workspace.rootDir))
  } finally {
    await repo.cleanup()
    await rm(workDir, { recursive: true, force: true })
  }
})

test('重复 checkout 同一提交保持幂等且不重复依赖网络', async () => {
  const repo = await createTestGitRepo()
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-workspace-'))
  const masker = createSecretMasker()
  const { logger, lines } = createLoggerCapture(masker)
  try {
    const workspace = await createRunWorkspace({ workDir, runId: 'run-checkout-2', logger, masker })
    await workspace.ensureCheckout(gitInfo(repo.remoteUrl, repo.commitSha))
    const firstCommit = workspace.checkedOutCommit
    await workspace.ensureCheckout(gitInfo(repo.remoteUrl, repo.commitSha))
    assert.equal(workspace.checkedOutCommit, firstCommit)
    assert.equal(lines.filter((line) => line.includes('已检出提交')).length, 1, '同一提交只应输出一次检出日志')
    assert.ok(!lines.join('\n').includes(GIT_PASSWORD), '日志不得包含 Git 凭据')
  } finally {
    await repo.cleanup()
    await rm(workDir, { recursive: true, force: true })
  }
})

test('凭据过期或远端不可达时显式失败且错误不含凭据', async () => {
  const repo = await createTestGitRepo()
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-workspace-'))
  const masker = createSecretMasker()
  const { logger, lines } = createLoggerCapture(masker)
  try {
    const workspace = await createRunWorkspace({ workDir, runId: 'run-checkout-3', logger, masker })
    await assert.rejects(
      () =>
        workspace.ensureCheckout(
          gitInfo(repo.remoteUrl, repo.commitSha, { expiresAt: new Date(Date.now() - 1_000).toISOString() }),
        ),
      /已过期/,
    )
    await assert.rejects(
      () => workspace.ensureCheckout(gitInfo('file:///nonexistent/repository/path', repo.commitSha)),
      (error: unknown) => error instanceof Error && error.message.includes('git fetch'),
    )
    assert.ok(!lines.join('\n').includes(GIT_PASSWORD), '失败日志不得包含 Git 凭据')
  } finally {
    await repo.cleanup()
    await rm(workDir, { recursive: true, force: true })
  }
})

test('拒绝不安全的运行标识，避免工作区路径逃逸', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-workspace-'))
  const masker = createSecretMasker()
  const { logger } = createLoggerCapture(masker)
  try {
    await assert.rejects(() => createRunWorkspace({ workDir, runId: '../escape', logger, masker }), /运行标识不合法/)
    await assert.rejects(() => createRunWorkspace({ workDir, runId: '', logger, masker }), /运行标识不合法/)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
})

test('启动时清理遗留运行工作区', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-workspace-'))
  const masker = createSecretMasker()
  const { logger } = createLoggerCapture(masker)
  try {
    const stale = join(workDir, 'runs', 'stale-run')
    await mkdir(join(stale, 'repository'), { recursive: true })
    await writeFile(join(stale, 'repository', 'leftover.txt'), 'old')
    await cleanupStaleRunWorkspaces(workDir, logger)
    await assert.rejects(stat(stale))
    const remaining = await readdir(join(workDir, 'runs'))
    assert.deepEqual(remaining, [])
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
})

test('git 子进程透传代理变量且不泄露其他环境变量', () => {
  const env = buildGitProcessEnv('/tmp/agent-run', 'x-access-token', GIT_PASSWORD, {
    PATH: '/usr/bin',
    HOME: '/home/agent',
    https_proxy: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    no_proxy: 'localhost,127.0.0.1',
    UNRELATED_SECRET: 'must-not-leak',
  })
  assert.equal(env.HOME, join('/tmp/agent-run', 'home'), 'git HOME 必须隔离到运行工作区')
  assert.equal(env.https_proxy, 'http://127.0.0.1:7890')
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.equal(env.no_proxy, 'localhost,127.0.0.1')
  assert.equal(env.UNRELATED_SECRET, undefined, '非白名单环境变量不得传入 git')
  const header = Buffer.from(String(env.GIT_CONFIG_VALUE_0).replace('Authorization: Basic ', ''), 'base64').toString(
    'utf8',
  )
  assert.ok(header.startsWith('x-access-token:'), '凭据头应包含短期用户名')
  assert.ok(!JSON.stringify(env).includes(GIT_PASSWORD), '凭据只允许出现在 base64 头中，不得明文出现')
})
