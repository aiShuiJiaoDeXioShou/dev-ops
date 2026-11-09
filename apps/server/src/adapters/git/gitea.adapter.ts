import {
  GitAdapterError,
  type GitAdapter,
  type GitAdapterInput,
  type GitObjectInput,
  type GitObjectSnapshot,
  type GitRemoteRepository,
} from './git.types.js'

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
  if (status >= 500) return new GitAdapterError('unavailable', 'Gitea 暂时不可用')
  return new GitAdapterError('unavailable', 'Gitea 请求失败')
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
    } catch {
      throw new GitAdapterError('unavailable', 'Gitea 暂时不可用')
    }
    if (!response.ok) throw classifyStatus(response.status)
    try {
      return (await response.json()) as T
    } catch {
      throw new GitAdapterError('invalid_response', 'Gitea 返回了无法解析的数据')
    }
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
  }
}
