import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 测试用本地 Git 仓库；file:// 远端不需要网络与凭据。 */
export interface TestGitRepo {
  /** 仓库目录（工作区）。 */
  dir: string
  /** 可直接作为运行计划 remoteUrl 的地址。 */
  remoteUrl: string
  /** 固定提交 SHA（第一个提交，不是 HEAD）。 */
  commitSha: string
  /** HEAD 提交 SHA。 */
  headSha: string
  /** 第一个提交写入的文件内容。 */
  firstContent: string
  cleanup(): Promise<void>
}

async function git(dir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  return stdout
}

/**
 * 创建两个提交的本地 Git 仓库，供工作区检出测试使用。
 * @returns 仓库目录、远端地址、固定提交与 HEAD 提交信息。
 */
export async function createTestGitRepo(): Promise<TestGitRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'devops-agent-git-'))
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 'agent-test@example.test'])
  await git(dir, ['config', 'user.name', 'agent-test'])
  const firstContent = 'first-commit-content\n'
  await writeFile(join(dir, 'app.txt'), firstContent, 'utf8')
  await writeFile(join(dir, 'build.sh'), 'echo build\n', { encoding: 'utf8', mode: 0o755 })
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'first commit'])
  const commitSha = (await git(dir, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(dir, 'app.txt'), 'second-commit-content\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'second commit'])
  const headSha = (await git(dir, ['rev-parse', 'HEAD'])).trim()
  return {
    dir,
    remoteUrl: `file://${dir}`,
    commitSha,
    headSha,
    firstContent,
    async cleanup(): Promise<void> {
      await rm(dir, { recursive: true, force: true })
    },
  }
}
