import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  GitAdapterError,
  type GitAdapter,
  type GitAdapterInput,
  type GitObjectInput,
  type GitObjectSnapshot,
  type GitRemoteRepository,
  type GitTreeEntry,
  type GitTreeInput,
  type GitFileInput,
  type GitFileContent,
} from './git.types.ts'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000

export interface GhCommandResult {
  stdout: string
  stderr: string
}
export type GhExecFile = (args: string[]) => Promise<GhCommandResult>

export interface GitHubCliAdapterOptions extends GitAdapterInput {
  exec?: GhExecFile
  timeoutMs?: number
  maxOutputBytes?: number
}

function isAllowlisted(slug: string, allowed: string[]): boolean {
  return allowed.some((item) => item.toLowerCase() === slug.toLowerCase())
}

function repoSlug(input: { repository: { namespace: string; name: string } }): string {
  return `${input.repository.namespace}/${input.repository.name}`
}

function remoteIdPattern(objectType: GitObjectInput['objectType']): RegExp {
  if (objectType === 'commit') return /^[0-9a-f]{7,64}$/i
  return /^[0-9]+$/
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new GitAdapterError('invalid_response', 'GitHub CLI 返回了无法解析的数据')
  }
}

function classify(error: unknown): GitAdapterError {
  if (error instanceof GitAdapterError) return error
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      killed?: boolean
      signal?: string
      code?: string | number
      stderr?: string
      message?: string
    }
    if (candidate.killed || candidate.signal === 'SIGTERM' || candidate.code === 'ETIMEDOUT') {
      return new GitAdapterError('timeout', 'GitHub CLI 请求超时')
    }
    const text = `${candidate.stderr ?? ''} ${candidate.message ?? ''}`
    if (/HTTP 401|HTTP 403|authentication|not logged in|auth/i.test(text))
      return new GitAdapterError('auth_failed', 'GitHub 授权不可用')
    if (/HTTP 404|not found/i.test(text)) return new GitAdapterError('not_found', '远端记录不存在')
    if (/HTTP 5\d\d|connection|network|ENOTFOUND|ECONN/i.test(text))
      return new GitAdapterError('unavailable', 'GitHub 暂时不可用')
  }
  return new GitAdapterError('unavailable', 'GitHub CLI 调用失败')
}

function createRunner(options: GitHubCliAdapterOptions): GhExecFile {
  if (options.exec) return options.exec
  return async (args) => {
    try {
      const result = await execFileAsync('gh', args, {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      })
      return { stdout: String(result.stdout), stderr: String(result.stderr) }
    } catch (error) {
      throw classify(error)
    }
  }
}

/**
 * 创建基于已登录 gh CLI 的只读 GitHub 适配器，仅用于本地/stg。
 * @param options 允许仓库、实例地址与可注入的命令执行器。
 * @returns 只读 GitAdapter。
 * @throws 未配置允许仓库时抛出错误。
 */
export function createGitHubCliAdapter(options: GitHubCliAdapterOptions): GitAdapter {
  const allowed = (options.allowedRepositories ?? []).map((item) => item.trim()).filter(Boolean)
  if (allowed.length === 0) throw new Error('GITHUB_ALLOWED_REPOS 至少配置一个仓库')
  const exec = createRunner(options)

  async function run(args: string[]): Promise<string> {
    let result: GhCommandResult
    try {
      result = await exec(args)
    } catch (error) {
      throw classify(error)
    }
    if (result.stdout.length > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
      throw new GitAdapterError('invalid_response', 'GitHub CLI 输出超出上限')
    }
    return result.stdout
  }

  async function getObject(input: GitObjectInput): Promise<GitObjectSnapshot> {
    const slug = repoSlug(input)
    if (!isAllowlisted(slug, allowed)) throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    if (!remoteIdPattern(input.objectType).test(input.remoteId)) {
      throw new GitAdapterError('unsupported', '远端对象标识不合法')
    }
    const route =
      input.objectType === 'commit'
        ? `repos/${slug}/commits/${input.remoteId}`
        : input.objectType === 'issue'
          ? `repos/${slug}/issues/${input.remoteId}`
          : `repos/${slug}/pulls/${input.remoteId}`
    const data = parseJson<Record<string, unknown>>(await run(['api', route]))
    if (input.objectType === 'commit') {
      const commit = data.commit as { message?: string } | undefined
      return {
        objectType: 'commit',
        remoteId: input.remoteId,
        title: String(commit?.message ?? '').split('\n')[0] ?? '',
        state: 'available',
        url: typeof data.html_url === 'string' ? data.html_url : null,
      }
    }
    return {
      objectType: input.objectType,
      remoteId: input.remoteId,
      title: typeof data.title === 'string' ? data.title : '',
      state: typeof data.state === 'string' ? data.state : 'unknown',
      url: typeof data.html_url === 'string' ? data.html_url : null,
    }
  }

  async function listTree(input: GitTreeInput): Promise<GitTreeEntry[]> {
    const slug = repoSlug(input)
    if (!isAllowlisted(slug, allowed)) throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    const data = parseJson<{ tree?: Array<{ path?: unknown; type?: unknown; size?: unknown }> }>(
      await run(['api', `repos/${slug}/git/trees/${encodeURIComponent(input.ref)}?recursive=1`]),
    )
    return (data.tree ?? [])
      .filter((item) => item.type === 'blob' || item.type === 'tree')
      .map((item) => ({
        path: typeof item.path === 'string' ? item.path : '',
        type: item.type === 'tree' ? ('directory' as const) : ('file' as const),
        size: typeof item.size === 'number' ? item.size : null,
      }))
      .filter((item) => item.path.length > 0)
  }

  async function getFile(input: GitFileInput): Promise<GitFileContent> {
    const slug = repoSlug(input)
    if (!isAllowlisted(slug, allowed)) throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    const encodedPath = input.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const data = parseJson<{ content?: unknown; encoding?: unknown; type?: unknown }>(
      await run(['api', `repos/${slug}/contents/${encodedPath}?ref=${encodeURIComponent(input.ref)}`]),
    )
    if (data.type === 'dir') throw new GitAdapterError('unsupported', '路径是目录')
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new GitAdapterError('unsupported', '远端文件不是可读取的文本内容')
    }
    const content = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8')
    return { path: input.path, content: content.slice(0, 200_000), truncated: content.length > 200_000 }
  }

  async function listBranches(input: { repository: { namespace: string; name: string } }): Promise<string[]> {
    const slug = repoSlug(input)
    if (!isAllowlisted(slug, allowed)) throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    const data = parseJson<Array<{ name?: unknown }>>(await run(['api', `repos/${slug}/branches?per_page=100`]))
    return data.flatMap((item) => (typeof item.name === 'string' ? [item.name] : []))
  }

  return {
    async checkConnection() {
      const identity = (await run(['api', 'user', '--jq', '.login'])).trim()
      if (!identity) throw new GitAdapterError('invalid_response', 'GitHub CLI 未返回登录身份')
      return { identity }
    },
    async listRepositories(): Promise<GitRemoteRepository[]> {
      const repositories: GitRemoteRepository[] = []
      for (const slug of allowed) {
        const data = parseJson<{ nameWithOwner?: string; url?: string; defaultBranchRef?: { name?: string } }>(
          await run(['repo', 'view', slug, '--json', 'nameWithOwner,url,defaultBranchRef']),
        )
        const [namespace, name] = slug.split('/')
        if (!namespace || !name) throw new GitAdapterError('invalid_response', '允许仓库配置不合法')
        repositories.push({
          remoteId: typeof data.nameWithOwner === 'string' ? data.nameWithOwner : slug,
          namespace,
          name,
          webUrl: typeof data.url === 'string' ? data.url : `https://github.com/${slug}`,
          defaultBranch: typeof data.defaultBranchRef?.name === 'string' ? data.defaultBranchRef.name : null,
        })
      }
      return repositories
    },
    getObject,
    listTree,
    getFile,
    listBranches,
  }
}
