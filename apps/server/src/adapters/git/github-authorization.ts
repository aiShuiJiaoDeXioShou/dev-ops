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

type GitHubUserGrant = { code: string; codeVerifier: string; redirectUri: string } | { refreshToken: string }

/**
 * 交换或者刷新 GitHub App 用户令牌。
 * @param input App 凭据、授权码或刷新令牌，以及可替换的 HTTP 客户端。
 * @returns 仅供服务端使用的令牌及可选的到期时间。
 * @throws GitHub 拒绝授权、响应不合法或请求失败时抛出错误。
 */
export async function exchangeGitHubUserTokens(input: {
  clientId: string
  clientSecret: string
  grant: GitHubUserGrant
  fetcher?: typeof fetch
}) {
  const body = new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret })
  if ('code' in input.grant) {
    body.set('code', input.grant.code)
    body.set('code_verifier', input.grant.codeVerifier)
    body.set('redirect_uri', input.grant.redirectUri)
  } else {
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', input.grant.refreshToken)
  }
  const response = await (input.fetcher ?? fetch)('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new GitAdapterError('unavailable', 'GitHub 用户授权暂不可用')
  const token: unknown = await response.json()
  if (!isRecord(token)) throw new GitAdapterError('invalid_response', 'GitHub 授权响应格式不合法')
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new GitAdapterError('auth_failed', 'GitHub 未签发用户授权')
  }
  return {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === 'string' && token.refresh_token ? token.refresh_token : null,
    expiresAt:
      typeof token.expires_in === 'number' && Number.isSafeInteger(token.expires_in) && token.expires_in > 0
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
  }
}

/**
 * 查询用户令牌对应的稳定 GitHub 身份。
 * @param accessToken GitHub App 用户令牌。
 * @param fetcher 可替换的 HTTP 客户端。
 * @returns GitHub 用户 ID 与公开用户名。
 * @throws 授权无效或身份数据不完整时抛出错误。
 */
export async function getGitHubUser(accessToken: string, fetcher: typeof fetch = fetch) {
  const user = await readJson(fetcher, 'https://api.github.com/user', {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || typeof user.login !== 'string' || !user.login) {
    throw new GitAdapterError('invalid_response', 'GitHub 用户身份不合法')
  }
  return { id: String(user.id), login: user.login }
}

/**
 * 查询 GitHub App 用户令牌对单个仓库的实际读写权限。
 * @param input 用户令牌、仓库坐标及可替换的 HTTP 客户端。
 * @returns 仓库权限；无权访问返回空值。
 * @throws 授权失效、限流、上游故障或响应格式异常时抛出错误。
 */
export async function getGitHubRepositoryPermissions(input: {
  accessToken: string
  namespace: string
  name: string
  fetcher?: typeof fetch
}) {
  const repository = `${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.name)}`
  const response = await (input.fetcher ?? fetch)(`https://api.github.com/repos/${repository}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${input.accessToken}` },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 401) throw new GitAdapterError('auth_failed', 'GitHub 用户授权已失效')
  if (
    !response.ok &&
    (response.status === 429 ||
      response.headers.get('x-ratelimit-remaining') === '0' ||
      response.headers.has('retry-after'))
  ) {
    throw new GitAdapterError('unavailable', 'GitHub 用户权限查询达到频率上限')
  }
  if ([403, 404, 451].includes(response.status)) return null
  if (!response.ok) throw new GitAdapterError('unavailable', 'GitHub 无法核对仓库权限')
  const row: unknown = await response.json()
  if (!isRecord(row) || !isRecord(row.permissions) || typeof row.permissions.pull !== 'boolean') {
    throw new GitAdapterError('invalid_response', 'GitHub 仓库权限响应不完整')
  }
  return {
    canRead: row.permissions.pull,
    canPush: row.permissions.push === true,
    allowsFork: row.allow_forking === true || (row.private === false && row.allow_forking !== false),
  }
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
  const tokens = await exchangeGitHubUserTokens({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    grant: { code: input.code, codeVerifier: input.codeVerifier, redirectUri: input.redirectUri },
    fetcher,
  })
  return verifyGitHubInstallationAccess(tokens.accessToken, input.installationId, fetcher)
}

function installationPageReader(accessToken: string, fetcher: typeof fetch) {
  const auth = {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }
  return (path: string, page: number) =>
    readJson(fetcher, `https://api.github.com${path}?per_page=${PAGE_SIZE}&page=${page}`, auth)
}

/**
 * 列出当前 GitHub 用户可访问的 App 安装，最多读取十页。
 * @param accessToken 仅供服务端使用的个人授权令牌。
 * @param fetcher 可替换的 HTTP 客户端。
 * @returns 未暂停安装的 ID 和所属账号。
 * @throws 响应不合法、范围无法完整读取或 GitHub 拒绝授权时抛出错误。
 */
export async function listGitHubUserInstallations(accessToken: string, fetcher: typeof fetch = fetch) {
  const listPage = installationPageReader(accessToken, fetcher)
  const installations: Array<{ id: number; login: string }> = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listPage('/user/installations', page)
    if (!Array.isArray(result.installations)) throw new GitAdapterError('invalid_response', 'GitHub 安装列表不合法')
    for (const item of result.installations) {
      if (
        !isRecord(item) ||
        typeof item.id !== 'number' ||
        !Number.isSafeInteger(item.id) ||
        item.id <= 0 ||
        !isRecord(item.account) ||
        typeof item.account.login !== 'string' ||
        !item.account.login
      ) {
        throw new GitAdapterError('invalid_response', 'GitHub 安装信息不合法')
      }
      if (!item.suspended_at) installations.push({ id: item.id, login: item.account.login })
    }
    if (result.installations.length < PAGE_SIZE || result.total_count === page * PAGE_SIZE) return installations
  }
  throw new GitAdapterError('invalid_response', 'GitHub 安装列表无法完整读取')
}

/**
 * 用个人授权核对选中的安装和当前用户可访问的仓库。
 * @param accessToken 仅供服务端使用的个人授权令牌。
 * @param installationId 要绑定的安装标识，必须出现在用户可访问的安装中。
 * @param fetcher 可替换的 HTTP 客户端。
 * @returns 安装所属账号及用户可访问的仓库 ID。
 * @throws 当前用户无权使用安装、验证超时或范围无法完整读取时抛出错误。
 */
export async function verifyGitHubInstallationAccess(
  accessToken: string,
  installationId: number,
  fetcher: typeof fetch = fetch,
): Promise<{ login: string; repositoryIds: Set<string> }> {
  const installation = (await listGitHubUserInstallations(accessToken, fetcher)).find(
    (item) => item.id === installationId,
  )
  if (!installation) throw new GitAdapterError('auth_failed', '当前 GitHub 用户无法访问该安装')
  const listPage = installationPageReader(accessToken, fetcher)
  const repositoryIds = new Set<string>()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await listPage(`/user/installations/${installationId}/repositories`, page)
    if (!Array.isArray(result.repositories) || typeof result.total_count !== 'number') {
      throw new GitAdapterError('invalid_response', 'GitHub 仓库授权范围不完整')
    }
    for (const item of result.repositories) {
      if (!isRecord(item) || typeof item.id !== 'number' || !Number.isSafeInteger(item.id)) {
        throw new GitAdapterError('invalid_response', 'GitHub 仓库授权范围不合法')
      }
      repositoryIds.add(String(item.id))
    }
    if (repositoryIds.size === result.total_count) return { login: installation.login, repositoryIds }
    if (result.repositories.length < PAGE_SIZE) break
  }
  throw new GitAdapterError('invalid_response', 'GitHub 仓库授权范围无法完整核对')
}
