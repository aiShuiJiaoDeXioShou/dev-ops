import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import {
  GitAdapterError,
  type GitAdapter,
  type GitAdapterInput,
  type GitCommitDetail,
  type GitCommitInput,
  type GitCommitListInput,
  type GitCommitSummary,
  type GitFileContent,
  type GitFileInput,
  type GitObjectInput,
  type GitObjectSnapshot,
  type GitPullRequestDiff,
  type GitPullRequestInput,
  type GitPullRequestListInput,
  type GitPullRequestSummary,
  type GitRemoteRepository,
  type GitRepositoryRef,
  type GitReviewStatus,
  type GitTreeEntry,
  type GitTreeInput,
} from './git.types.ts'
import {
  GIT_READ_LIMITS,
  aggregateReviewStatus,
  buildPullRequestDetail,
  filterPullRequestsByAuthor,
  normalizePageInput,
  parseGitHubCommit,
  parseGitHubCommitDetail,
  parseGitHubPullRequest,
  parseGitHubPullRequestFile,
  parseGitHubReviewFact,
  truncateDiffText,
} from './git.normalize.ts'

const TIMEOUT_MS = 10_000

export interface GitHubAppClient {
  request(route: string, params?: Record<string, unknown>): Promise<{ data: unknown }>
}

export interface GitHubAppAdapterOptions extends GitAdapterInput {
  appId: string
  privateKey: string
  installationId: number
  client?: GitHubAppClient
}

function classify(error: unknown): GitAdapterError {
  if (error instanceof GitAdapterError) return error
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  if (status === 401) return new GitAdapterError('auth_failed', 'GitHub App 授权不可用')
  if (status === 403) {
    // GitHub 对限流也返回 403，必须与授权失效区分，避免把来源限流误报成凭据失效。
    return isRateLimited(error)
      ? new GitAdapterError('unavailable', 'GitHub 请求被限流')
      : new GitAdapterError('auth_failed', 'GitHub App 授权不可用')
  }
  if (status === 404) return new GitAdapterError('not_found', '远端记录不存在')
  if (status === 408 || status === 504) return new GitAdapterError('timeout', 'GitHub App 请求超时')
  if (status >= 500) return new GitAdapterError('unavailable', 'GitHub 暂时不可用')
  return new GitAdapterError('unavailable', 'GitHub App 请求失败')
}

/** 判断 GitHub 错误是否由限流或速率配额耗尽引起。 */
function isRateLimited(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  if (/rate limit/i.test(message)) return true
  if (!('response' in error) || typeof error.response !== 'object' || error.response === null) return false
  if (!('headers' in error.response) || typeof error.response.headers !== 'object') return false
  const headers = error.response.headers
  if (headers === null || !('x-ratelimit-remaining' in headers)) return false
  return headers['x-ratelimit-remaining'] === '0'
}

function createClient(options: GitHubAppAdapterOptions): GitHubAppClient {
  if (options.client) return options.client
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: options.appId, privateKey: options.privateKey, installationId: options.installationId },
    request: { timeout: TIMEOUT_MS },
  })
  return {
    async request(route: string, params?: Record<string, unknown>) {
      return octokit.request(route as never, params as never)
    },
  }
}

function isAllowlisted(slug: string, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true
  return allowed.some((item) => item.toLowerCase() === slug.toLowerCase())
}

/**
 * 创建 GitHub App 安装身份只读适配器。
 * @param options App 凭据、安装 ID、允许仓库与可注入客户端。
 * @returns 只读 GitAdapter。
 */
export function createGitHubAppAdapter(options: GitHubAppAdapterOptions): GitAdapter {
  const client = createClient(options)
  async function getObject(input: GitObjectInput): Promise<GitObjectSnapshot> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    if (!isAllowlisted(slug, options.allowedRepositories))
      throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    const route =
      input.objectType === 'commit'
        ? 'GET /repos/{owner}/{repo}/commits/{ref}'
        : input.objectType === 'issue'
          ? 'GET /repos/{owner}/{repo}/issues/{issue_number}'
          : 'GET /repos/{owner}/{repo}/pulls/{pull_number}'
    const params =
      input.objectType === 'commit'
        ? { owner: input.repository.namespace, repo: input.repository.name, ref: input.remoteId }
        : input.objectType === 'issue'
          ? { owner: input.repository.namespace, repo: input.repository.name, issue_number: Number(input.remoteId) }
          : { owner: input.repository.namespace, repo: input.repository.name, pull_number: Number(input.remoteId) }
    let data: Record<string, unknown>
    try {
      data = (await client.request(route, params)).data as Record<string, unknown>
    } catch (error) {
      throw classify(error)
    }
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
    const slug = `${input.repository.namespace}/${input.repository.name}`
    if (!isAllowlisted(slug, options.allowedRepositories))
      throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    let data: { tree?: Array<{ path?: unknown; type?: unknown; size?: unknown }> }
    try {
      data = (
        await client.request('GET /repos/{owner}/{repo}/git/trees/{ref}', {
          owner: input.repository.namespace,
          repo: input.repository.name,
          ref: input.ref,
          recursive: '1',
        })
      ).data as typeof data
    } catch (error) {
      throw classify(error)
    }
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
    const slug = `${input.repository.namespace}/${input.repository.name}`
    if (!isAllowlisted(slug, options.allowedRepositories))
      throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    let data: { content?: unknown; encoding?: unknown; type?: unknown }
    try {
      data = (
        await client.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner: input.repository.namespace,
          repo: input.repository.name,
          path: input.path,
          ref: input.ref,
        })
      ).data as typeof data
    } catch (error) {
      throw classify(error)
    }
    if (data.type === 'dir') throw new GitAdapterError('unsupported', '路径是目录')
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new GitAdapterError('unsupported', '远端文件不是可读取的文本内容')
    }
    const content = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8')
    return { path: input.path, content: content.slice(0, 200_000), truncated: content.length > 200_000 }
  }

  async function listBranches(input: { repository: { namespace: string; name: string } }): Promise<string[]> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    if (!isAllowlisted(slug, options.allowedRepositories))
      throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    let data: Array<{ name?: unknown }>
    try {
      data = (
        await client.request('GET /repos/{owner}/{repo}/branches', {
          owner: input.repository.namespace,
          repo: input.repository.name,
          per_page: 100,
        })
      ).data as Array<{ name?: unknown }>
    } catch (error) {
      throw classify(error)
    }
    return data.flatMap((item) => (typeof item.name === 'string' ? [item.name] : []))
  }

  /** 校验仓库 allowlist 并返回 GitHub 路径参数；不在范围内的仓库不发起来源请求。 */
  function requireAllowed(input: { repository: GitRepositoryRef }): { owner: string; repo: string } {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    if (!isAllowlisted(slug, options.allowedRepositories))
      throw new GitAdapterError('unsupported', '仓库不在允许范围内')
    return { owner: input.repository.namespace, repo: input.repository.name }
  }

  /** 发起 GitHub REST 请求并返回 data；所有来源错误统一映射为 GitAdapterError。 */
  async function requestData(route: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      return (await client.request(route, params)).data
    } catch (error) {
      throw classify(error)
    }
  }

  /** 读取差异等文本响应；来源返回 JSON 时视为 invalid_response，不把空文本冒充成功。 */
  async function requestText(route: string, params?: Record<string, unknown>): Promise<string> {
    const data = await requestData(route, params)
    if (typeof data !== 'string') throw new GitAdapterError('invalid_response', 'GitHub 未返回差异文本')
    return data
  }

  async function listCommits(input: GitCommitListInput): Promise<GitCommitSummary[]> {
    const { owner, repo } = requireAllowed(input)
    const { page, pageSize } = normalizePageInput(input)
    const params: Record<string, unknown> = { owner, repo, per_page: pageSize, page }
    if (input.ref) params.sha = input.ref
    const data = await requestData('GET /repos/{owner}/{repo}/commits', params)
    if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'GitHub 提交列表不合法')
    return data.map((item) => parseGitHubCommit(item))
  }

  async function getCommit(input: GitCommitInput): Promise<GitCommitDetail> {
    const { owner, repo } = requireAllowed(input)
    const data = await requestData('GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo, ref: input.ref })
    return parseGitHubCommitDetail(data)
  }

  async function listPullRequests(input: GitPullRequestListInput): Promise<GitPullRequestSummary[]> {
    const { owner, repo } = requireAllowed(input)
    const { page, pageSize } = normalizePageInput(input)
    const data = await requestData('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      state: input.state ?? 'open',
      per_page: pageSize,
      page,
      sort: 'updated',
      direction: 'desc',
    })
    if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'GitHub PR 列表不合法')
    // 列表接口不携带评审信息，reviewStatus 保持 unknown；详情读取时再按评审记录推导。
    return filterPullRequestsByAuthor(
      data.map((item) => parseGitHubPullRequest(item)),
      input.author,
    )
  }

  /** 读取 PR 评审状态；来源缺少评审能力时记 unknown，其他失败必须向上传递。 */
  async function loadReviewStatus(owner: string, repo: string, pullNumber: number): Promise<GitReviewStatus> {
    try {
      const data = await requestData('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: GIT_READ_LIMITS.maxPageSize,
      })
      if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'GitHub 评审列表不合法')
      return aggregateReviewStatus(data.map((item) => parseGitHubReviewFact(item)))
    } catch (error) {
      if (error instanceof GitAdapterError && error.code === 'not_found') return 'unknown'
      throw error instanceof GitAdapterError ? error : classify(error)
    }
  }

  /** 读取 PR 变更文件；达到来源单页上限时标记可能存在更多文件。 */
  async function loadChangedFiles(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<{ items: unknown[]; hasMore: boolean }> {
    const data = await requestData('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: GIT_READ_LIMITS.maxChangedFiles,
      page: 1,
    })
    if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'GitHub 变更文件列表不合法')
    return { items: data, hasMore: data.length >= GIT_READ_LIMITS.maxChangedFiles }
  }

  async function getPullRequest(input: GitPullRequestInput) {
    const { owner, repo } = requireAllowed(input)
    const data = await requestData('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: input.number,
    })
    const [reviewStatus, changedFiles] = await Promise.all([
      loadReviewStatus(owner, repo, input.number),
      loadChangedFiles(owner, repo, input.number),
    ])
    const summary = parseGitHubPullRequest(data, reviewStatus)
    return buildPullRequestDetail(summary, changedFiles.items, parseGitHubPullRequestFile, changedFiles.hasMore)
  }

  async function getPullRequestDiff(input: GitPullRequestInput): Promise<GitPullRequestDiff> {
    const { owner, repo } = requireAllowed(input)
    const text = await requestText('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: input.number,
      headers: { accept: 'application/vnd.github.v3.diff' },
    })
    return truncateDiffText(text)
  }

  return {
    async checkConnection() {
      try {
        const data = (
          await client.request('GET /app/installations/{installation_id}', {
            installation_id: options.installationId,
          })
        ).data as { account?: { login?: string } }
        const identity = data.account?.login
        if (!identity) throw new GitAdapterError('invalid_response', 'GitHub App 未返回安装身份')
        return { identity }
      } catch (error) {
        throw classify(error)
      }
    },
    async listRepositories(): Promise<GitRemoteRepository[]> {
      const repositories: GitRemoteRepository[] = []
      for (let page = 1; page <= 10; page += 1) {
        let data: { total_count?: number; repositories?: Array<Record<string, unknown>> }
        try {
          data = (await client.request('GET /installation/repositories', { per_page: 100, page })).data as typeof data
        } catch (error) {
          throw classify(error)
        }
        for (const item of data.repositories ?? []) {
          const fullName = typeof item.full_name === 'string' ? item.full_name : ''
          const [namespace, name] = fullName.split('/')
          if (!namespace || !name || !isAllowlisted(fullName, options.allowedRepositories)) continue
          repositories.push({
            remoteId: String(item.id ?? fullName),
            namespace,
            name,
            webUrl: typeof item.html_url === 'string' ? item.html_url : `https://github.com/${fullName}`,
            defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : null,
          })
        }
        if ((data.repositories?.length ?? 0) < 100) break
      }
      return repositories
    },
    getObject,
    listTree,
    getFile,
    listBranches,
    listCommits,
    getCommit,
    listPullRequests,
    getPullRequest,
    getPullRequestDiff,
  }
}
