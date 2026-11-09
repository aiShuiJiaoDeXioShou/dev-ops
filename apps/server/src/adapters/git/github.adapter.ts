import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import {
  GitAdapterError,
  type GitAdapter,
  type GitAdapterInput,
  type GitObjectInput,
  type GitObjectSnapshot,
  type GitRemoteRepository,
} from './git.types.js'

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
  if (status === 401 || status === 403) return new GitAdapterError('auth_failed', 'GitHub App 授权不可用')
  if (status === 404) return new GitAdapterError('not_found', '远端记录不存在')
  if (status === 408 || status === 504) return new GitAdapterError('timeout', 'GitHub App 请求超时')
  if (status >= 500) return new GitAdapterError('unavailable', 'GitHub 暂时不可用')
  return new GitAdapterError('unavailable', 'GitHub App 请求失败')
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

  return {
    async checkConnection() {
      try {
        const data = (await client.request('GET /installation')).data as { account?: { login?: string } }
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
  }
}
