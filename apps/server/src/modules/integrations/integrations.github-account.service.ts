import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../platform/config/env.ts'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import { GITHUB_CALLBACK_PATH } from './integrations.service.ts'
import { gitHubUserAuthorization } from './integrations.tables.ts'

const PROFILE_PATH = '/settings/profile'
/** GitHub 回调通过前缀识别个人流程，绑定资格仍由签名和会话确定。 */
export const PERSONAL_GITHUB_STATE_PREFIX = 'account.'
const PROJECT_PATH = /^\/projects\/[0-9a-f-]{36}\/(?:code|prs|pipelines)$/i
const STATE_TTL_MS = 10 * 60_000

type UserTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null }
interface GitHubAccountPort {
  exchangeTokens(input: {
    clientId: string
    clientSecret: string
    grant: { code: string; codeVerifier: string; redirectUri: string } | { refreshToken: string }
  }): Promise<UserTokens>
  getUser(accessToken: string): Promise<{ id: string; login: string }>
  getRepositoryPermissions(input: {
    accessToken: string
    namespace: string
    name: string
  }): Promise<{ canRead: boolean; canPush: boolean; allowsFork: boolean } | null>
}
type AuthorizationRow = Pick<
  typeof gitHubUserAuthorization.$inferSelect,
  'id' | 'user_id' | 'ciphertext' | 'iv' | 'auth_tag' | 'key_version' | 'expires_at'
>

function validReturnPath(path: string): boolean {
  return path === PROFILE_PATH || PROJECT_PATH.test(path)
}

function mac(secret: string, input: string): Buffer {
  return createHmac('sha256', secret).update(input).digest()
}

function verifier(secret: string, state: string): string {
  return mac(secret, `github-account-pkce:${state}`).toString('base64url')
}

function readReturnPath(secret: string, state: string, userId: string): string {
  const invalid = () => new ApiError(ERROR_CODES.VALIDATION_ERROR, 'GitHub 绑定请求不合法或已过期')
  if (!state.startsWith(PERSONAL_GITHUB_STATE_PREFIX)) throw invalid()
  const [body, signature, extra] = state.slice(PERSONAL_GITHUB_STATE_PREFIX.length).split('.')
  if (!body || !signature || extra !== undefined) throw invalid()
  const expected = mac(secret, `github-account-state:${body}`)
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid()
  const value: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (
    typeof value !== 'object' ||
    value === null ||
    !('userId' in value) ||
    value.userId !== userId ||
    !('expiresAt' in value) ||
    typeof value.expiresAt !== 'number' ||
    value.expiresAt <= Date.now() ||
    !('returnTo' in value) ||
    typeof value.returnTo !== 'string' ||
    !validReturnPath(value.returnTo)
  )
    throw invalid()
  return value.returnTo
}

function requiresAccount(): ApiError {
  return new ApiError(ERROR_CODES.GITHUB_ACCOUNT_REQUIRED, '请绑定或重新授权你的 GitHub 账号')
}

function providerErrorCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null
}

function payload(tokens: UserTokens, cipher: SecretCipher) {
  const encrypted = cipher.encrypt(
    JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
  )
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
    key_version: encrypted.keyVersion,
    expires_at: tokens.expiresAt,
    updated_at: new Date(),
  }
}

function unwrap(row: AuthorizationRow, cipher: SecretCipher) {
  const value: unknown = JSON.parse(
    cipher.decrypt({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      keyVersion: row.key_version,
    }),
  )
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    !('refreshToken' in value) ||
    (value.refreshToken !== null && typeof value.refreshToken !== 'string')
  )
    throw new Error('数据库 GitHub 用户令牌内容不合法')
  return { accessToken: value.accessToken, refreshToken: value.refreshToken }
}

/**
 * 组装 GitHub 个人绑定及仓库访问授权，令牌只在服务端解密和使用。
 * @param deps 数据库、应用配置、凭据加密器及 GitHub 个人授权端口。
 * @returns 供会话路由及代码用例使用的个人绑定服务。
 */
export function createGitHubAccountService(deps: {
  db: Database
  config: AppConfig
  cipher: SecretCipher | null
  github: GitHubAccountPort
}) {
  const { db, config, cipher, github } = deps
  const refreshes = new Map<string, Promise<string>>()

  function authorizationConfig() {
    const { AUTH_SECRET: secret, GITHUB_APP_CLIENT_ID: clientId, GITHUB_APP_CLIENT_SECRET: clientSecret } = config
    if (!secret || !clientId || !clientSecret || !cipher) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'GitHub 个人绑定尚未配置')
    }
    return {
      secret,
      clientId,
      clientSecret,
      cipher,
      redirectUri: new URL(GITHUB_CALLBACK_PATH, config.APP_ORIGIN).href,
    }
  }

  async function findAuthorization(userId: string) {
    const [row] = await db
      .select({
        id: gitHubUserAuthorization.id,
        user_id: gitHubUserAuthorization.user_id,
        ciphertext: gitHubUserAuthorization.ciphertext,
        iv: gitHubUserAuthorization.iv,
        auth_tag: gitHubUserAuthorization.auth_tag,
        key_version: gitHubUserAuthorization.key_version,
        expires_at: gitHubUserAuthorization.expires_at,
      })
      .from(gitHubUserAuthorization)
      .where(eq(gitHubUserAuthorization.user_id, userId))
      .limit(1)
    return row
  }

  async function refreshAccessToken(row: AuthorizationRow, refreshToken: string) {
    const settings = authorizationConfig()
    let tokens: UserTokens
    try {
      tokens = await github.exchangeTokens({ ...settings, grant: { refreshToken } })
    } catch (error) {
      if (providerErrorCode(error) !== 'auth_failed') throw error
      const latest = await findAuthorization(row.user_id)
      if (latest && latest.ciphertext !== row.ciphertext) return unwrap(latest, settings.cipher).accessToken
      throw requiresAccount()
    }
    const [modified] = await db
      .update(gitHubUserAuthorization)
      .set(payload(tokens, settings.cipher))
      .where(and(eq(gitHubUserAuthorization.id, row.id), eq(gitHubUserAuthorization.ciphertext, row.ciphertext)))
      .returning({ id: gitHubUserAuthorization.id })
    if (modified) return tokens.accessToken
    const latest = await findAuthorization(row.user_id)
    if (latest) return unwrap(latest, settings.cipher).accessToken
    throw requiresAccount()
  }

  /**
   * 获取服务端访问 GitHub 所需的个人令牌，过期时协调并发刷新。
   * @param userId 平台当前会话的用户标识。
   * @returns 仅供服务端调用 GitHub 的令牌。
   * @throws 尚未绑定、需要重新授权或凭据不可用时抛出错误。
   */
  async function userToken(userId: string): Promise<string> {
    const row = await findAuthorization(userId)
    if (!row) throw requiresAccount()
    if (!cipher) throw new ApiError(ERROR_CODES.EXTERNAL_UNAVAILABLE, 'GitHub 用户凭据暂不可用')
    const tokens = unwrap(row, cipher)
    if (!row.expires_at || row.expires_at.getTime() > Date.now()) return tokens.accessToken
    if (!tokens.refreshToken) throw requiresAccount()
    const inProgress = refreshes.get(row.ciphertext)
    if (inProgress) return inProgress
    const refresh = refreshAccessToken(row, tokens.refreshToken).finally(() => refreshes.delete(row.ciphertext))
    refreshes.set(row.ciphertext, refresh)
    return refresh
  }

  /**
   * 查询登录用户的个人 GitHub 绑定状态。
   * @param userId 浏览器会话用户标识。
   * @returns 已绑定的公开用户名及当前部署是否启用绑定。
   */
  async function status(userId: string) {
    const [row] = await db
      .select({ login: gitHubUserAuthorization.login })
      .from(gitHubUserAuthorization)
      .where(eq(gitHubUserAuthorization.user_id, userId))
      .limit(1)
    return {
      login: row?.login ?? null,
      enabled: Boolean(config.AUTH_SECRET && config.GITHUB_APP_CLIENT_ID && config.GITHUB_APP_CLIENT_SECRET && cipher),
    }
  }

  /**
   * 发起当前用户的绑定授权。
   * @param userId 浏览器会话用户标识。
   * @param returnTo 授权完成后返回的站内路径。
   * @returns 含 PKCE challenge 的 GitHub 授权地址。
   * @throws 没有配置绑定能力或站内路径不合法时抛出业务错误。
   */
  function start(userId: string, returnTo: string) {
    if (!validReturnPath(returnTo)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'GitHub 授权返回地址不合法')
    const settings = authorizationConfig()
    const body = Buffer.from(
      JSON.stringify({ userId, returnTo, expiresAt: Date.now() + STATE_TTL_MS, nonce: randomUUID() }),
    ).toString('base64url')
    const state = `${PERSONAL_GITHUB_STATE_PREFIX}${body}.${mac(settings.secret, `github-account-state:${body}`).toString('base64url')}`
    const url = new URL('https://github.com/login/oauth/authorize')
    url.search = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      state,
      code_challenge: createHash('sha256').update(verifier(settings.secret, state)).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString()
    return { authorizationUrl: url.href }
  }

  /**
   * 核对当前会话和授权 state 后，将 GitHub 身份与用户令牌绑定到平台账号。
   * @param userId 浏览器会话用户标识。
   * @param state GitHub 回传的签名状态。
   * @param code 一次性授权码；缺省表示用户取消授权。
   * @returns 回跳路径及可显示的授权结果；GitHub 身份已经绑定到其他平台账号时返回冲突。
   * @throws 会话不匹配、状态无效或持久化失败时抛出错误。
   */
  async function complete(userId: string, state: string, code: string | undefined) {
    const settings = authorizationConfig()
    const returnTo = readReturnPath(settings.secret, state, userId)
    if (!code) return { returnTo, result: 'failed' }
    try {
      const tokens = await github.exchangeTokens({
        ...settings,
        grant: {
          code,
          codeVerifier: verifier(settings.secret, state),
          redirectUri: settings.redirectUri,
        },
      })
      const identity = await github.getUser(tokens.accessToken)
      const update = { github_user_id: identity.id, login: identity.login, ...payload(tokens, settings.cipher) }
      await db
        .insert(gitHubUserAuthorization)
        .values({ id: randomUUID(), user_id: userId, ...update })
        .onConflictDoUpdate({ target: gitHubUserAuthorization.user_id, set: update })
      return { returnTo, result: 'connected' }
    } catch (error) {
      const code = providerErrorCode(error)
      if (code === 'auth_failed' || code === 'invalid_response' || code === 'unavailable')
        return { returnTo, result: 'failed' }
      if (isUniqueViolation(error)) return { returnTo, result: 'conflict' }
      throw error
    }
  }

  /**
   * 验证成员是否能访问指定 GitHub 仓库。
   * @param input 当前用户、仓库坐标、操作及由安装身份查询可见性的函数。
   * @returns 写入检查成功时返回服务端用户令牌，读取检查成功时返回空值。
   * @throws 缺少个人授权、GitHub 权限不足或权限查询失败时拒绝操作。
   */
  async function authorizeRepository(input: {
    userId: string
    namespace: string
    name: string
    operation: 'read' | 'write' | 'create_pull_request'
    isPublic: () => Promise<boolean>
  }): Promise<string | undefined> {
    if (input.operation === 'read') {
      try {
        if (await input.isPublic()) return undefined
      } catch {
        throw new ApiError(ERROR_CODES.EXTERNAL_UNAVAILABLE, '暂时无法核对 GitHub 仓库可见性')
      }
    }
    try {
      const accessToken = await userToken(input.userId)
      const permissions = await github.getRepositoryPermissions({
        namespace: input.namespace,
        name: input.name,
        accessToken,
      })
      const canWrite = Boolean(
        permissions?.canPush || (input.operation === 'create_pull_request' && permissions?.allowsFork),
      )
      if (!permissions?.canRead || (input.operation !== 'read' && !canWrite)) {
        throw new ApiError(
          ERROR_CODES.GITHUB_REPOSITORY_FORBIDDEN,
          input.operation === 'read' ? '你的 GitHub 账号无权读取此仓库' : '你的 GitHub 账号缺少此操作所需的仓库权限',
        )
      }
      return input.operation === 'read' ? undefined : accessToken
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (providerErrorCode(error) === 'auth_failed') throw requiresAccount()
      throw new ApiError(ERROR_CODES.EXTERNAL_UNAVAILABLE, '暂时无法核对 GitHub 仓库权限')
    }
  }

  return { status, start, complete, authorizeRepository, userToken }
}

export type GitHubAccountService = ReturnType<typeof createGitHubAccountService>
