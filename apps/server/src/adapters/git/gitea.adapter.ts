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
  type GitAddCommentInput,
  type GitCommentRef,
  type GitCreateIssueInput,
  type GitCreatePullRequestInput,
  type GitIssueRef,
  type GitPullRequestRef,
  GitWriteError,
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
  parseGiteaCommit,
  parseGiteaCommitDetail,
  parseGiteaPullRequest,
  parseGiteaPullRequestFile,
  parseGiteaReviewFact,
  truncateDiffText,
} from './git.normalize.ts'

const TIMEOUT_MS = 10_000
const MAX_PAGES = 10

export type GiteaFetch = (input: string, init: RequestInit) => Promise<Response>

export interface GiteaAdapterOptions extends GitAdapterInput {
  token: string
  fetch?: GiteaFetch
}

function classifyStatus(status: number): GitAdapterError {
  if (status === 401 || status === 403) return new GitAdapterError('auth_failed', 'Gitea 授权不可用')
  if (status === 404) return new GitAdapterError('not_found', '远端记录不存在')
  if (status === 408 || status === 504) return new GitAdapterError('timeout', 'Gitea 请求超时')
  if (status === 429 || status >= 500) return new GitAdapterError('unavailable', 'Gitea 暂时不可用或被限流')
  return new GitAdapterError('unavailable', 'Gitea 请求失败')
}

/** 识别 fetch 超时；其余网络错误统一视为不可用，保留失败分类供接口映射。 */
function classifyFetchError(error: unknown): GitAdapterError {
  if (error instanceof GitAdapterError) return error
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = error.name
    if (name === 'TimeoutError' || name === 'AbortError') return new GitAdapterError('timeout', 'Gitea 请求超时')
  }
  return new GitAdapterError('unavailable', 'Gitea 暂时不可用')
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 创建 Gitea 服务 Token 只读适配器。
 * @param options 实例基址、服务 Token 与可注入 fetch。
 * @returns 只读 GitAdapter。
 */
export function createGiteaAdapter(options: GiteaAdapterOptions): GitAdapter {
  const baseUrl = normalizeBaseUrl(options.instanceUrl)
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('Gitea 实例地址必须是 HTTP/HTTPS URL')
  const fetchImpl = options.fetch ?? fetch
  async function request<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
        headers: { Authorization: `token ${options.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw classifyFetchError(error)
    }
    if (!response.ok) throw classifyStatus(response.status)
    try {
      return (await response.json()) as T
    } catch {
      throw new GitAdapterError('invalid_response', 'Gitea 返回了无法解析的数据')
    }
  }

  /** 读取差异等文本响应；非 2xx 按状态分类，读取失败不返回空文本冒充成功。 */
  async function requestText(path: string): Promise<string> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
        headers: { Authorization: `token ${options.token}`, Accept: 'text/plain' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw classifyFetchError(error)
    }
    if (!response.ok) throw classifyStatus(response.status)
    try {
      return await response.text()
    } catch {
      throw new GitAdapterError('invalid_response', 'Gitea 返回了无法解析的差异内容')
    }
  }

  /** 发起 Gitea 写请求；409/422 归类为重复/冲突，便于调用方回读。 */
  async function postWrite<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
        method: 'POST',
        headers: {
          Authorization: `token ${options.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      if (error instanceof GitAdapterError) throw error
      throw new GitWriteError('unavailable', 'Gitea 写请求失败')
    }
    if (response.status === 401 || response.status === 403) {
      throw new GitWriteError('auth_failed', 'Gitea 授权不可用')
    }
    if (response.status === 404) throw new GitWriteError('unsupported', 'Gitea 接口或资源不存在')
    if (response.status === 409 || response.status === 422) {
      throw new GitWriteError('duplicate', 'Gitea 已存在同类记录或参数冲突')
    }
    if (!response.ok) throw new GitWriteError('unavailable', 'Gitea 暂时不可用')
    try {
      return (await response.json()) as T
    } catch {
      throw new GitWriteError('invalid_response', 'Gitea 返回了无法解析的数据')
    }
  }

  async function listCommits(input: GitCommitListInput): Promise<GitCommitSummary[]> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const { page, pageSize } = normalizePageInput(input)
    const sha = input.ref ? `&sha=${encodeURIComponent(input.ref)}` : ''
    const data = await request<unknown>(`/repos/${slug}/commits?page=${page}&limit=${pageSize}${sha}`)
    if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'Gitea 提交列表不合法')
    return data.map((item) => parseGiteaCommit(item))
  }

  async function getCommit(input: GitCommitInput): Promise<GitCommitDetail> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const data = await request<unknown>(`/repos/${slug}/git/commits/${encodeURIComponent(input.ref)}`)
    return parseGiteaCommitDetail(data)
  }

  async function listPullRequests(input: GitPullRequestListInput): Promise<GitPullRequestSummary[]> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const { page, pageSize } = normalizePageInput(input)
    const state = encodeURIComponent(input.state ?? 'open')
    const data = await request<unknown>(`/repos/${slug}/pulls?state=${state}&page=${page}&limit=${pageSize}`)
    if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'Gitea PR 列表不合法')
    // 列表接口不携带评审信息，reviewStatus 保持 unknown；详情读取时再按评审记录推导。
    return filterPullRequestsByAuthor(
      data.map((item) => parseGiteaPullRequest(item)),
      input.author,
    )
  }

  /** 读取 PR 评审状态；来源缺少评审接口时记 unknown，其他失败必须向上传递。 */
  async function loadReviewStatus(slug: string, pullNumber: number): Promise<GitReviewStatus> {
    try {
      const data = await request<unknown>(`/repos/${slug}/pulls/${pullNumber}/reviews?limit=100&page=1`)
      if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'Gitea 评审列表不合法')
      return aggregateReviewStatus(data.map((item) => parseGiteaReviewFact(item)))
    } catch (error) {
      if (error instanceof GitAdapterError && error.code === 'not_found') return 'unknown'
      throw error
    }
  }

  /**
   * 读取 PR 变更文件；旧版 Gitea 没有该接口时返回 unsupported，
   * 因为此时 PR 详情已读取成功，404 只可能是能力缺失而非记录不存在。
   */
  async function loadChangedFiles(slug: string, pullNumber: number): Promise<{ items: unknown[]; hasMore: boolean }> {
    try {
      const data = await request<unknown>(
        `/repos/${slug}/pulls/${pullNumber}/files?limit=${GIT_READ_LIMITS.maxChangedFiles}&page=1`,
      )
      if (!Array.isArray(data)) throw new GitAdapterError('invalid_response', 'Gitea 变更文件列表不合法')
      return { items: data, hasMore: data.length >= GIT_READ_LIMITS.maxChangedFiles }
    } catch (error) {
      if (error instanceof GitAdapterError && error.code === 'not_found') {
        throw new GitAdapterError('unsupported', 'Gitea 版本不支持读取 PR 变更文件')
      }
      throw error
    }
  }

  async function getPullRequest(input: GitPullRequestInput) {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const data = await request<unknown>(`/repos/${slug}/pulls/${input.number}`)
    const [reviewStatus, changedFiles] = await Promise.all([
      loadReviewStatus(slug, input.number),
      loadChangedFiles(slug, input.number),
    ])
    const summary = parseGiteaPullRequest(data, reviewStatus)
    return buildPullRequestDetail(summary, changedFiles.items, parseGiteaPullRequestFile, changedFiles.hasMore)
  }

  async function getPullRequestDiff(input: GitPullRequestInput): Promise<GitPullRequestDiff> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    return truncateDiffText(await requestText(`/repos/${slug}/pulls/${input.number}.diff`))
  }

  async function getObject(input: GitObjectInput): Promise<GitObjectSnapshot> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const route =
      input.objectType === 'commit'
        ? `/repos/${slug}/git/commits/${input.remoteId}`
        : input.objectType === 'issue'
          ? `/repos/${slug}/issues/${input.remoteId}`
          : `/repos/${slug}/pulls/${input.remoteId}`
    const data = await request<Record<string, unknown>>(route)
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
    const data = await request<{ tree?: Array<{ path?: unknown; type?: unknown; size?: unknown }> }>(
      `/repos/${slug}/git/trees/${encodeURIComponent(input.ref)}?recursive=true&per_page=1000`,
    )
    return (data.tree ?? [])
      .filter((item) => item.type === 'blob' || item.type === 'tree' || item.type === 'commit')
      .map((item) => ({
        path: typeof item.path === 'string' ? item.path : '',
        type: item.type === 'tree' ? ('directory' as const) : ('file' as const),
        size: typeof item.size === 'number' ? item.size : null,
      }))
      .filter((item) => item.path.length > 0)
  }

  async function getFile(input: GitFileInput): Promise<GitFileContent> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const encodedPath = input.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const data = await request<{ content?: unknown; encoding?: unknown; type?: unknown }>(
      `/repos/${slug}/contents/${encodedPath}?ref=${encodeURIComponent(input.ref)}`,
    )
    if (data.type === 'dir') throw new GitAdapterError('unsupported', '路径是目录')
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new GitAdapterError('unsupported', '远端文件不是可读取的文本内容')
    }
    const content = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8')
    return { path: input.path, content: content.slice(0, 200_000), truncated: content.length > 200_000 }
  }

  async function listBranches(input: { repository: { namespace: string; name: string } }): Promise<string[]> {
    const slug = `${input.repository.namespace}/${input.repository.name}`
    const data = await request<Array<{ name?: unknown }>>(`/repos/${slug}/branches?limit=100`)
    return data.flatMap((item) => (typeof item.name === 'string' ? [item.name] : []))
  }

  return {
    async checkConnection() {
      const user = await request<{ login?: string }>('/user')
      if (!user.login) throw new GitAdapterError('invalid_response', 'Gitea 未返回登录身份')
      return { identity: user.login }
    },
    async listRepositories(): Promise<GitRemoteRepository[]> {
      const repositories: GitRemoteRepository[] = []
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await request<{ data?: Array<Record<string, unknown>> }>(`/repos/search?limit=50&page=${page}`)
        const items = data.data ?? []
        for (const item of items) {
          const fullName = typeof item.full_name === 'string' ? item.full_name : ''
          const [namespace, name] = fullName.split('/')
          if (!namespace || !name) continue
          repositories.push({
            remoteId: String(item.id ?? fullName),
            namespace,
            name,
            webUrl: typeof item.html_url === 'string' ? item.html_url : `${baseUrl}/${fullName}`,
            defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : null,
          })
        }
        if (items.length < 50) break
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
    async createPullRequest(input: GitCreatePullRequestInput): Promise<GitPullRequestRef> {
      const slug = `${input.repository.namespace}/${input.repository.name}`
      const data = await postWrite<Record<string, unknown>>(`/repos/${slug}/pulls`, {
        title: input.title,
        body: input.body,
        head: input.sourceBranch,
        base: input.targetBranch,
      })
      const number = Number(data.number)
      if (!Number.isSafeInteger(number) || number <= 0) {
        throw new GitWriteError('invalid_response', 'Gitea 未返回 PR 编号')
      }
      return {
        number,
        url: typeof data.html_url === 'string' ? data.html_url : null,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
      }
    },
    async createIssue(input: GitCreateIssueInput): Promise<GitIssueRef> {
      const slug = `${input.repository.namespace}/${input.repository.name}`
      const data = await postWrite<Record<string, unknown>>(`/repos/${slug}/issues`, {
        title: input.title,
        body: input.body,
      })
      const number = Number(data.number)
      if (!Number.isSafeInteger(number) || number <= 0) {
        throw new GitWriteError('invalid_response', 'Gitea 未返回 Issue 编号')
      }
      return { number, url: typeof data.html_url === 'string' ? data.html_url : null }
    },
    async addComment(input: GitAddCommentInput): Promise<GitCommentRef> {
      const slug = `${input.repository.namespace}/${input.repository.name}`
      const data = await postWrite<Record<string, unknown>>(`/repos/${slug}/issues/${input.targetNumber}/comments`, {
        body: input.body,
      })
      const id = Number(data.id)
      if (!Number.isSafeInteger(id) || id <= 0) throw new GitWriteError('invalid_response', 'Gitea 未返回评论标识')
      return { id: String(id), url: typeof data.html_url === 'string' ? data.html_url : null }
    },
  }
}
