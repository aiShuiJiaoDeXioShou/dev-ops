import { execFile } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import type { RunPlanGit } from '@dev-ops/pipeline-protocol'

import { describeError } from './errors.ts'
import type { AgentLogger } from './logger.ts'
import type { SecretMasker } from './masking.ts'

const execFileAsync = promisify(execFile)

/** Git 网络操作超时；私有仓库拉取可能较慢，但仍必须有限。 */
const DEFAULT_GIT_TIMEOUT_MS = 300_000
/** git 命令输出上限，避免异常远端把 Agent 内存打满。 */
const GIT_MAX_BUFFER_BYTES = 8 * 1_024 * 1_024
/** 错误摘要保留的最大字符数，避免把整段 git 输出写进运行记录。 */
const MAX_ERROR_DETAIL_CHARS = 2_000

export interface RunWorkspaceOptions {
  /** Agent 工作根目录。 */
  workDir: string
  /** 平台运行标识；用于隔离不同运行的工作区。 */
  runId: string
  logger: AgentLogger
  masker: SecretMasker
  gitTimeoutMs?: number
}

/** 一次运行独占的工作区；执行结束后必须调用 remove 清理。 */
export interface RunWorkspace {
  /** 运行工作区根目录（run 级）。 */
  readonly rootDir: string
  /** Git 检出的仓库目录，挂载进任务容器。 */
  readonly checkoutDir: string
  /** 产物打包临时目录，随运行一起清理。 */
  readonly tempDir: string
  /** 已检出的提交 SHA；用于重复 checkout 步骤幂等。 */
  readonly checkedOutCommit: string | undefined
  /**
   * 确保仓库检出到租约固定提交；同一提交重复调用不重复执行 git。
   * @param git 平台签发的短期 Git 凭据与固定提交。
   * @param timeoutMs 可选的本次操作超时；运行级超时剩余时间不足时由执行器传入。
   * @throws 凭据过期、远端不可达、提交不存在或 HEAD 校验失败时抛出，错误信息已脱敏。
   */
  ensureCheckout(git: RunPlanGit, timeoutMs?: number): Promise<void>
  /**
   * 删除整个运行工作区；进程被中断时也必须尽力执行。
   * @throws 删除失败时抛出，调用方需要把清理失败上报平台。
   */
  remove(): Promise<void>
}

/** 运行标识只能包含安全字符，避免拼接出工作区外的路径。 */
function validateRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(runId) || runId === '.' || runId === '..') {
    throw new Error(`运行标识不合法，无法创建隔离工作区：${runId}`)
  }
  return runId
}

/** 拒绝非 HTTP(S)/file 远端协议；避免通过远端地址执行任意 git 子进程行为。 */
function validateRemoteUrl(remoteUrl: string): string {
  let url: URL
  try {
    url = new URL(remoteUrl)
  } catch {
    throw new Error('Git 远端地址不是合法 URL')
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
    throw new Error(`Agent 不支持 Git 远端协议：${url.protocol}`)
  }
  if (url.username || url.password) throw new Error('Git 远端地址不能内嵌凭据')
  return remoteUrl
}

function errorDetail(error: unknown, masker: SecretMasker): string {
  const detail = error instanceof Error ? error.message : String(error)
  return masker.maskText(detail).slice(0, MAX_ERROR_DETAIL_CHARS)
}

/**
 * 创建一次运行的临时工作区目录。
 * @param options 工作根目录、运行标识、日志器与脱敏器。
 * @returns 含仓库目录与临时目录的工作区句柄；目录已创建。
 * @throws 运行标识不合法或目录无法创建时抛出。
 */
export async function createRunWorkspace(options: RunWorkspaceOptions): Promise<RunWorkspace> {
  const gitTimeoutMs = options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  const runId = validateRunId(options.runId)
  const rootDir = resolve(options.workDir, 'runs', runId)
  const checkoutDir = join(rootDir, 'repository')
  const tempDir = join(rootDir, 'tmp')
  await mkdir(checkoutDir, { recursive: true })
  await mkdir(tempDir, { recursive: true })
  let checkedOutCommit: string | undefined

  /** 构造最小 git 环境：凭据只经进程环境传入，不写入命令行与仓库配置。 */
  function gitEnv(username: string, password: string): NodeJS.ProcessEnv {
    const basic = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
    return {
      PATH: process.env.PATH ?? '',
      HOME: join(rootDir, 'home'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      // 通过 GIT_CONFIG_* 注入临时远程认证头：不出现在 argv（ps 可见）与 .git/config（落盘）。
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: '',
    }
  }

  async function runGit(args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...args], {
        cwd: checkoutDir,
        env,
        timeout: timeoutMs,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        windowsHide: true,
      })
      return stdout
    } catch (error) {
      throw new Error(`git ${args[0] ?? ''} 执行失败：${errorDetail(error, options.masker)}`)
    }
  }

  async function fetchCommit(git: RunPlanGit, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
    options.masker.addSecrets([git.password])
    try {
      // 优先只拉取固定提交的浅历史；远端不允许按 SHA 拉取时退回完整拉取再校验。
      await runGit(['fetch', '-q', '--depth=1', 'origin', git.commitSha], env, timeoutMs)
    } catch (depthError) {
      options.logger.warn(`按提交浅拉取失败，回退完整拉取：${errorDetail(depthError, options.masker)}`)
      await runGit(['fetch', '-q', 'origin'], env, timeoutMs)
    }
  }

  async function checkout(git: RunPlanGit, timeoutMs?: number): Promise<void> {
    if (checkedOutCommit === git.commitSha) return
    const remoteUrl = validateRemoteUrl(git.remoteUrl)
    if (Date.parse(git.expiresAt) <= Date.now()) throw new Error('Git 短期凭据已过期，无法检出代码')
    await mkdir(join(rootDir, 'home'), { recursive: true })
    const env = gitEnv(git.username, git.password)
    const perCallTimeoutMs = Math.max(1_000, Math.min(gitTimeoutMs, timeoutMs ?? gitTimeoutMs))
    const insideGit = await hasGitDirectory(checkoutDir)
    if (!insideGit) {
      await runGit(['init', '-q'], env, perCallTimeoutMs)
      await runGit(['remote', 'add', 'origin', remoteUrl], env, perCallTimeoutMs)
    }
    await fetchCommit(git, env, perCallTimeoutMs)
    await runGit(['checkout', '-q', '--detach', git.commitSha], env, perCallTimeoutMs)
    const head = (await runGit(['rev-parse', 'HEAD'], env, perCallTimeoutMs)).trim()
    if (!head.startsWith(git.commitSha) && !git.commitSha.startsWith(head)) {
      throw new Error('Git 检出的提交与运行计划固定的提交不一致')
    }
    checkedOutCommit = head
    options.logger.info(`已检出提交 ${head.slice(0, 12)}`)
  }

  return {
    rootDir,
    checkoutDir,
    tempDir,
    get checkedOutCommit(): string | undefined {
      return checkedOutCommit
    },
    ensureCheckout: checkout,
    async remove(): Promise<void> {
      await rm(rootDir, { recursive: true, force: true, maxRetries: 3 })
    },
  }
}

async function hasGitDirectory(checkoutDir: string): Promise<boolean> {
  try {
    const entries = await readdir(checkoutDir)
    return entries.includes('.git')
  } catch {
    return false
  }
}

/**
 * 清理上次进程退出或清理失败遗留的运行工作区。
 * @param workDir Agent 工作根目录。
 * @param logger 日志器。
 * @remarks 只删除 `<workDir>/runs/` 下的子目录；单个目录删除失败只记录告警，不阻止启动。
 */
export async function cleanupStaleRunWorkspaces(workDir: string, logger: AgentLogger): Promise<void> {
  const runsDir = resolve(workDir, 'runs')
  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch {
    return
  }
  for (const entry of entries) {
    const target = resolve(runsDir, entry)
    if (!target.startsWith(`${runsDir}${sep}`)) continue
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 3 })
      logger.warn(`已清理遗留工作区：${entry}`)
    } catch (error) {
      logger.warn(`清理遗留工作区 ${entry} 失败：${describeError(error)}`)
    }
  }
}
