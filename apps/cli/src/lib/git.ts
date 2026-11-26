import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { CliError } from './errors.ts'

const execFileAsync = promisify(execFile)

/** 单条 git 命令的超时；本地仓库操作不应超过该值，超时说明仓库状态异常。 */
const GIT_TIMEOUT_MS = 5_000

/** 本地提交摘要。 */
export interface LocalCommit {
  sha: string
  subject: string
}

/**
 * 在指定目录执行 git 并返回去除首尾空白的标准输出。
 * @param cwd 工作目录。
 * @param args git 参数，不经过 shell，避免注入。
 * @returns 标准输出文本。
 * @throws git 不可用、目录不是仓库或命令失败时抛出退出码 1 的 CliError，消息不包含命令输出。
 */
export async function gitText(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    return stdout.trim()
  } catch {
    throw new CliError(`git ${args[0] ?? ''} 执行失败，请确认当前目录位于 Git 仓库内`, 1, { code: 'GIT_FAILED' })
  }
}

/**
 * 解析当前 worktree 私有 git 目录下的文件路径；文件不会进入版本库，每个 worktree 各自独立。
 * @param cwd 工作目录。
 * @param relativePath 相对 git 目录的路径。
 * @returns 绝对路径。
 */
export async function gitPrivatePath(cwd: string, relativePath: string): Promise<string> {
  return resolve(cwd, await gitText(cwd, ['rev-parse', '--git-path', relativePath]))
}

/** 读取仓库根目录。 */
export async function gitTopLevel(cwd: string): Promise<string> {
  return gitText(cwd, ['rev-parse', '--show-toplevel'])
}

/** 读取 HEAD 完整 SHA。 */
export async function gitHead(cwd: string): Promise<string> {
  return gitText(cwd, ['rev-parse', 'HEAD'])
}

/**
 * 读取 origin 远端地址；没有 origin 时取第一个远端。
 * @param cwd 工作目录。
 * @returns 远端地址。
 * @throws 仓库没有任何远端时抛出 CliError。
 */
export async function gitRemoteUrl(cwd: string): Promise<string> {
  const remotes = (await gitText(cwd, ['remote'])).split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote) throw new CliError('当前仓库没有配置 Git 远端', 1, { code: 'GIT_REMOTE_MISSING' })
  return gitText(cwd, ['remote', 'get-url', remote])
}

/**
 * 列出基线之后、当前 HEAD 可达的提交，按提交先后排序。
 * @param cwd 工作目录。
 * @param baseSha 绑定事项时记录的基线提交。
 * @returns 提交列表；基线即 HEAD 时为空。
 */
export async function gitCommitsSince(cwd: string, baseSha: string): Promise<LocalCommit[]> {
  const output = await gitText(cwd, ['log', '--reverse', '--format=%H%x09%s', `${baseSha}..HEAD`])
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', ...subject] = line.split('\t')
      return { sha, subject: subject.join('\t') }
    })
}

/**
 * 列出基线之后尚未出现在任何远端跟踪分支上的提交。
 * @param cwd 工作目录。
 * @param baseSha 基线提交。
 * @returns 未推送提交的 SHA 集合；结果依赖本地远端跟踪分支，未 fetch 时可能偏多。
 */
export async function gitUnpushedShas(cwd: string, baseSha: string): Promise<Set<string>> {
  const output = await gitText(cwd, ['rev-list', `${baseSha}..HEAD`, '--not', '--remotes'])
  return new Set(output.split('\n').filter(Boolean))
}

/**
 * 列出相对基线改动过的文件，包含未提交的工作区改动。
 * @param cwd 工作目录。
 * @param baseSha 基线提交。
 * @returns 仓库相对路径。
 */
export async function gitChangedFiles(cwd: string, baseSha: string): Promise<string[]> {
  return (await gitText(cwd, ['diff', '--name-only', baseSha])).split('\n').filter(Boolean)
}

/**
 * 把 Git 远端或网页地址归一化为 `host/owner/name`，用于比对仓库是否一致。
 * @param url HTTPS、SSH 或 scp 形式的地址。
 * @returns 小写、去掉协议、凭据和 `.git` 后缀的地址。
 */
export function normalizeRepositoryUrl(url: string): string {
  const scpLike = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(url.trim())
  const raw = scpLike ? `${scpLike[1]}/${scpLike[2]}` : url.trim().replace(/^[a-z+]+:\/\//i, '')
  return raw
    .replace(/^[^@/]+@/, '')
    .replace(/^([^/:]+):\d+\//, '$1/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}
