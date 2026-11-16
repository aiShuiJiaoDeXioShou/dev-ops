import { GitAdapterError } from './git.types.ts'

const PAGE_SIZE = 100
const MAX_PAGES = 10
const TIMEOUT_MS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(fetcher: typeof fetch, url: string, init: RequestInit) {
  const response = await fetcher(url, { ...init, redirect: 'error' })
  if (!response.ok) throw new GitAdapterError('auth_failed', 'GitHub 无法验证当前授权')
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new GitAdapterError('invalid_response', 'GitHub 授权响应格式不合法')
  return body
}

/**
 * 用 GitHub 用户授权核对安装归属与当前用户可访问的仓库范围。
 * @param input 已校验的 OAuth 回调参数、GitHub App 配置和测试可替换的 HTTP 客户端。
 * @returns 安装所属个人或组织名称及用户可访问的远端仓库标识；令牌仅用于本次验证。
 * @throws 来源拒绝、验证超时、响应不完整或该用户无法使用安装时拒绝绑定。
 */
export async function verifyGitHubInstallation(input: {
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
  redirectUri: string
  installationId: number
  fetcher?: typeof fetch
}): Promise<{ login: string; repositoryIds: Set<string> }> {
  const fetcher = input.fetcher ?? fetch
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const token = await readJson(fetcher, 'https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    }),
    signal,
  })
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new GitAdapterError('auth_failed', 'GitHub 未签发用户授权')
  }
  const auth = {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}` },
    signal,
  }
  const listPage = (path: string, page: number) =>
    readJson(fetcher, `https://api.github.com${path}?per_page=${PAGE_SIZE}&page=${page}`, auth)
  let login: string | undefined
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listPage('/user/installations', page)
    if (!Array.isArray(result.installations)) throw new GitAdapterError('invalid_response', 'GitHub 安装列表不合法')
    const installation: unknown = result.installations.find(
      (item: unknown) => isRecord(item) && item.id === input.installationId,
    )
    if (isRecord(installation) && isRecord(installation.account) && typeof installation.account.login === 'string') {
      login = installation.account.login
      break
    }
    if (result.installations.length < PAGE_SIZE) break
  }
  if (!login) throw new GitAdapterError('auth_failed', '当前 GitHub 用户无法访问该安装')

  const repositoryIds = new Set<string>()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listPage(`/user/installations/${input.installationId}/repositories`, page)
    if (!Array.isArray(result.repositories) || typeof result.total_count !== 'number') {
      throw new GitAdapterError('invalid_response', 'GitHub 仓库授权范围不完整')
    }
    for (const item of result.repositories) {
      if (!isRecord(item) || typeof item.id !== 'number' || !Number.isSafeInteger(item.id)) {
        throw new GitAdapterError('invalid_response', 'GitHub 仓库授权范围不合法')
      }
      repositoryIds.add(String(item.id))
    }
    if (repositoryIds.size === result.total_count) return { login, repositoryIds }
    if (result.repositories.length < PAGE_SIZE) break
  }
  throw new GitAdapterError('invalid_response', 'GitHub 仓库授权范围无法完整核对')
}
