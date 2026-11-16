import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AppConfig } from '../../platform/config/env.ts'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { findMembership, lockTeam } from '../identity/identity.repository.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import type { ConfigurationService } from '../configuration/configuration.service.ts'
import {
  findConnectionRepositories,
  markRepositoriesUnavailable,
  upsertGitRepositories,
} from '../code/code.repository.ts'
import {
  findActiveConnectionIds,
  findGitConnectionById,
  findGitConnections,
  findGitHubInstallation,
  insertGitConnection,
  updateGitConnection,
} from './integrations.repository.ts'

const NAME_MAX = 120

export interface GitConnectionView {
  id: string
  teamId: string
  providerKey: string
  instanceUrl: string
  name: string
  status: string
  authKind: string
  externalIdentity: string | null
  lastCheckedAt: string | null
  lastErrorCode: string | null
  repositoryScopeSyncedAt: string | null
  createdAt: string
}
export interface GitProviderView {
  providerKey: string
  name: string
  authModes: string[]
}
export interface AuthorizationPending {
  authorizationUrl: string
  expiresAt: string
}
export type CreateConnectionResult = GitConnectionView | AuthorizationPending
export interface GitReadAdapter {
  checkConnection(): Promise<{ identity: string }>
  listRepositories(): Promise<
    Array<{ remoteId: string; namespace: string; name: string; webUrl: string; defaultBranch: string | null }>
  >
}
type GitConnectionRow = NonNullable<Awaited<ReturnType<typeof findGitConnectionById>>>
export type GitAdapterFactory = (
  connection: Pick<
    GitConnectionRow,
    'id' | 'team_id' | 'provider_key' | 'instance_url' | 'auth_kind' | 'secret_id' | 'external_identity'
  >,
) => Promise<GitReadAdapter>

type GitHubInstallationVerifier = (input: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  codeVerifier: string
  installationId: number
}) => Promise<{ login: string; repositoryIds: ReadonlySet<string> }>

type AuthorizationState = { teamId: string; userId: string; exp: number; nonce: string; installationId?: number }
/** 团队安装和个人绑定共用 GitHub App 中登记的回调。 */
export const GITHUB_CALLBACK_PATH = '/api/v1/git-authorizations/github/callback'

function gitErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string')
    return error.code
  return 'unavailable'
}

export interface IntegrationsServiceDeps {
  db: Database
  config: AppConfig
  configuration: ConfigurationService | null
  adapterFactory?: GitAdapterFactory
  verifyGitHubInstallation?: GitHubInstallationVerifier
}

function normalizeName(name: string): string {
  const value = name.trim()
  if (value.length === 0 || value.length > NAME_MAX)
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '连接名称长度必须在 1-120 个字符之间')
  return value
}

function view(row: NonNullable<Awaited<ReturnType<typeof insertGitConnection>>>): GitConnectionView {
  return {
    id: row.id,
    teamId: row.team_id,
    providerKey: row.provider_key,
    instanceUrl: row.instance_url,
    name: row.name,
    status: row.status,
    authKind: row.auth_kind,
    externalIdentity: row.external_identity,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    lastErrorCode: row.last_error_code,
    repositoryScopeSyncedAt: row.repository_scope_synced_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

function signState(payload: AuthorizationState, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

function verifyState(state: string, secret: string): AuthorizationState {
  const [body, signature] = state.split('.')
  if (!body || !signature) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('teamId' in payload) ||
    typeof payload.teamId !== 'string' ||
    !('userId' in payload) ||
    typeof payload.userId !== 'string' ||
    !('exp' in payload) ||
    typeof payload.exp !== 'number' ||
    !('nonce' in payload) ||
    typeof payload.nonce !== 'string'
  ) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  }
  if (payload.exp * 1000 <= Date.now()) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 已过期')
  const installationId = 'installationId' in payload ? payload.installationId : undefined
  if (
    installationId !== undefined &&
    (typeof installationId !== 'number' || !Number.isSafeInteger(installationId) || installationId <= 0)
  ) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'GitHub 安装标识不合法')
  }
  return { teamId: payload.teamId, userId: payload.userId, exp: payload.exp, nonce: payload.nonce, installationId }
}

function githubCodeVerifier(state: string, secret: string): string {
  // 从已签名的授权上下文派生 PKCE verifier，浏览器只收到 challenge。
  return createHmac('sha256', secret).update(`github-installation-pkce:${state}`).digest('base64url')
}

/**
 * 创建 Git 连接集成服务。
 * @param deps 数据库、应用配置、凭据服务与可选适配器工厂。
 * @returns 连接创建/检查/同步/撤权、授权 state 与适配器解析。
 */
export function createIntegrationsService(deps: IntegrationsServiceDeps) {
  const { db, config } = deps

  function githubAuthorizationConfig() {
    const {
      AUTH_SECRET: secret,
      GITHUB_APP_SLUG: slug,
      GITHUB_APP_CLIENT_ID: clientId,
      GITHUB_APP_CLIENT_SECRET: clientSecret,
    } = config
    if (
      !config.GITHUB_APP_ID ||
      !config.GITHUB_APP_PRIVATE_KEY_PATH ||
      !secret ||
      !slug ||
      !clientId ||
      !clientSecret
    ) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'GitHub App 安装或用户授权配置不完整')
    }
    return { secret, slug, clientId, clientSecret, redirectUri: new URL(GITHUB_CALLBACK_PATH, config.APP_ORIGIN).href }
  }

  function requireConfiguration(): ConfigurationService {
    if (!deps.configuration) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '凭据加密尚未配置')
    return deps.configuration
  }

  function adapterFor(connection: Parameters<GitAdapterFactory>[0]): Promise<GitReadAdapter> {
    if (!deps.adapterFactory) return Promise.reject(new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Git 适配器未装配'))
    return deps.adapterFactory(connection)
  }

  async function requireConnectionAdmin(actor: SessionUser, connectionId: string) {
    const connection = await findGitConnectionById(db, connectionId)
    if (!connection) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Git 连接不存在')
    await requireTeamMember(db, actor.id, connection.team_id, ['admin'])
    if (connection.auth_kind === 'github_cli') {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '旧 GitHub CLI 连接已停用，请通过 GitHub App 添加连接')
    }
    return connection
  }

  async function listConnections(actor: SessionUser, teamId: string): Promise<GitConnectionView[]> {
    await requireTeamMember(db, actor.id, teamId)
    const rows = await findGitConnections(db, teamId)
    return rows.map(view)
  }

  async function checkAndSync(
    connection: NonNullable<Awaited<ReturnType<typeof findGitConnectionById>>>,
  ): Promise<{ status: string; errorCode?: string }> {
    const checkedAt = new Date()
    try {
      const adapter = await adapterFor(connection)
      const identity = await adapter.checkConnection()
      const repositories = await adapter.listRepositories()
      await upsertGitRepositories(db, {
        teamId: connection.team_id,
        connectionId: connection.id,
        providerKey: connection.provider_key,
        repositories,
      })
      await updateGitConnection(db, connection.id, {
        status: 'active',
        // App 安装连接的 external_identity 保存安装 ID，适配器按它签安装令牌；不能用账号登录名覆盖。
        ...(connection.auth_kind === 'github_app_installation' ? {} : { externalIdentity: identity.identity }),
        lastCheckedAt: checkedAt,
        lastErrorCode: null,
        repositoryScopeSyncedAt: checkedAt,
      })
      return { status: 'active' }
    } catch (error) {
      const code = gitErrorCode(error)
      await updateGitConnection(db, connection.id, { status: 'invalid', lastCheckedAt: checkedAt, lastErrorCode: code })
      return { status: 'invalid', errorCode: code }
    }
  }

  async function createConnection(
    actor: SessionUser,
    teamId: string,
    input: {
      providerKey: string
      name: string
      instanceUrl?: string
      token?: string
    },
  ): Promise<CreateConnectionResult> {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const name = normalizeName(input.name)
    if (input.providerKey === 'github') {
      const { slug, secret } = githubAuthorizationConfig()
      const exp = Math.floor(Date.now() / 1000) + 600
      const state = signState({ teamId, userId: actor.id, exp, nonce: randomUUID() }, secret)
      return {
        authorizationUrl: `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`,
        expiresAt: new Date(exp * 1000).toISOString(),
      }
    }
    if (input.providerKey !== 'gitea') throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '不支持的 Git 提供方')
    if (!input.instanceUrl || !/^https?:\/\//.test(input.instanceUrl))
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Gitea 实例地址不合法')
    if (!input.token) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Gitea Token 必填')
    const secret = await requireConfiguration().createSecret(actor, teamId, {
      kind: 'git_token',
      name: `${name} Token`,
      value: input.token,
    })
    const row = await insertGitConnection(db, {
      id: randomUUID(),
      teamId,
      providerKey: 'gitea',
      instanceUrl: input.instanceUrl.replace(/\/+$/, ''),
      name,
      authKind: 'gitea_token',
      secretId: secret.id,
      externalIdentity: null,
      createdByUserId: actor.id,
    })
    if (!row) throw new Error('Git 连接创建失败')
    await checkAndSync(row)
    const refreshed = await findGitConnectionById(db, row.id)
    return view(refreshed ?? row)
  }

  /**
   * 安装后发起 GitHub 用户授权，并确认安装范围可由当前管理员绑定到团队。
   * @param actor 当前登录用户。
   * @param providerKey 回调提供方。
   * @param input 已签名的界面状态、安装标识与可选 OAuth 授权码。
   * @returns 后续授权地址或已经同步的连接；重复授权保留原连接与项目关联。
   * @throws 身份不匹配、安装无权访问或无法核对仓库范围时拒绝绑定。
   */
  async function completeAuthorization(
    actor: SessionUser,
    providerKey: string,
    input: { state: string; installationId?: number; code?: string },
  ): Promise<CreateConnectionResult> {
    if (providerKey !== 'github') throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '不支持的 Git 提供方')
    const { secret, clientId, clientSecret, redirectUri } = githubAuthorizationConfig()
    const payload = verifyState(input.state, secret)
    if (payload.userId !== actor.id) throw new ApiError(ERROR_CODES.FORBIDDEN, '授权发起人不匹配')
    await requireTeamMember(db, actor.id, payload.teamId, ['admin'])
    if (!input.code) {
      const installationId = input.installationId
      if (!installationId || !Number.isSafeInteger(installationId) || installationId <= 0 || payload.installationId) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'GitHub 安装尚未完成')
      }
      const state = signState({ ...payload, installationId }, secret)
      const codeChallenge = createHash('sha256').update(githubCodeVerifier(state, secret)).digest('base64url')
      const url = new URL('https://github.com/login/oauth/authorize')
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString()
      return { authorizationUrl: url.href, expiresAt: new Date(payload.exp * 1000).toISOString() }
    }
    const installationId = payload.installationId
    if (!installationId || !deps.verifyGitHubInstallation) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '缺少待验证的 GitHub 安装')
    }
    const verified = await deps.verifyGitHubInstallation({
      clientId,
      clientSecret,
      redirectUri,
      installationId,
      code: input.code,
      codeVerifier: githubCodeVerifier(input.state, secret),
    })
    const candidate = {
      id: randomUUID(),
      team_id: payload.teamId,
      provider_key: 'github',
      instance_url: 'https://github.com',
      auth_kind: 'github_app_installation',
      secret_id: null,
      external_identity: String(installationId),
    }
    const adapter = await adapterFor(candidate)
    const repositories = await adapter.listRepositories()
    if (repositories.some((repository) => !verified.repositoryIds.has(repository.remoteId))) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, '当前 GitHub 用户无法查看安装已授权的全部仓库')
    }
    const checkedAt = new Date()
    const name = normalizeName(`GitHub ${verified.login} (#${installationId})`)
    return db.transaction(async (tx) => {
      // 同团队重复授权保留连接和仓库标识，项目关联仍指向同一安装。
      await lockTeam(tx, payload.teamId)
      const membership = await findMembership(tx, payload.teamId, actor.id)
      if (membership?.status !== 'active' || membership.role !== 'admin') {
        throw new ApiError(ERROR_CODES.FORBIDDEN, '需要团队管理员权限')
      }
      const previous = await findGitHubInstallation(tx, payload.teamId, candidate.external_identity)
      const connection =
        previous ??
        (await insertGitConnection(tx, {
          id: candidate.id,
          teamId: payload.teamId,
          providerKey: candidate.provider_key,
          instanceUrl: candidate.instance_url,
          name,
          authKind: candidate.auth_kind,
          secretId: null,
          externalIdentity: candidate.external_identity,
          createdByUserId: actor.id,
        }))
      if (!connection) throw new Error('GitHub 连接保存失败')
      await upsertGitRepositories(tx, {
        teamId: payload.teamId,
        connectionId: connection.id,
        providerKey: candidate.provider_key,
        repositories,
      })
      const updated = await updateGitConnection(tx, connection.id, {
        name,
        status: 'active',
        lastCheckedAt: checkedAt,
        lastErrorCode: null,
        repositoryScopeSyncedAt: checkedAt,
      })
      if (!updated) throw new Error('GitHub 连接更新失败')
      return view(updated)
    })
  }

  async function checkConnection(actor: SessionUser, connectionId: string) {
    const connection = await requireConnectionAdmin(actor, connectionId)
    const result = await checkAndSync(connection)
    const refreshed = await findGitConnectionById(db, connectionId)
    return {
      status: result.status,
      checkedAt: new Date().toISOString(),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      connection: refreshed ? view(refreshed) : null,
    }
  }

  async function syncRepositories(actor: SessionUser, connectionId: string) {
    const connection = await requireConnectionAdmin(actor, connectionId)
    try {
      const adapter = await adapterFor(connection)
      const repositories = await adapter.listRepositories()
      await upsertGitRepositories(db, {
        teamId: connection.team_id,
        connectionId: connection.id,
        providerKey: connection.provider_key,
        repositories,
      })
      await updateGitConnection(db, connection.id, {
        status: 'active',
        repositoryScopeSyncedAt: new Date(),
        lastErrorCode: null,
      })
      return { synced: repositories.length, total: repositories.length, checkedAt: new Date().toISOString() }
    } catch (error) {
      const code = gitErrorCode(error)
      await updateGitConnection(db, connection.id, { status: 'invalid', lastErrorCode: code })
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库同步失败', { errorCode: code })
    }
  }

  async function revokeConnection(actor: SessionUser, connectionId: string, reason: string) {
    const connection = await requireConnectionAdmin(actor, connectionId)
    const note = reason.trim()
    if (note.length === 0 || note.length > 2000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '撤权原因长度不合法')
    await updateGitConnection(db, connection.id, { status: 'revoked', lastCheckedAt: new Date(), lastErrorCode: null })
    await markRepositoriesUnavailable(db, connection.id, 'removed')
    if (connection.secret_id && deps.configuration) {
      try {
        await deps.configuration.revokeSecret(actor, connection.team_id, connection.secret_id)
      } catch {
        /* 已撤销的凭据不阻断连接撤权 */
      }
    }
    const refreshed = await findGitConnectionById(db, connection.id)
    if (!refreshed) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Git 连接不存在')
    return view(refreshed)
  }

  async function listRepositories(
    actor: SessionUser,
    connectionId: string,
    filters: { search?: string; page?: number; pageSize?: number },
  ) {
    const connection = await findGitConnectionById(db, connectionId)
    if (!connection) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Git 连接不存在')
    await requireTeamMember(db, actor.id, connection.team_id)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    const { rows, total } = await findConnectionRepositories(db, connectionId, {
      search: filters.search?.trim() || undefined,
      page,
      pageSize,
    })
    return {
      items: rows.map((row) => ({
        id: row.id,
        connectionId: row.connection_id,
        providerKey: row.provider_key,
        namespace: row.namespace,
        name: row.name,
        webUrl: row.web_url,
        defaultBranch: row.default_branch,
        status: row.status,
      })),
      page,
      pageSize,
      total,
    }
  }

  async function getAdapterForConnection(connectionId: string): Promise<GitReadAdapter> {
    const connection = await findGitConnectionById(db, connectionId)
    if (!connection || connection.status !== 'active') throw new Error('Git 连接不可用')
    return adapterFor(connection)
  }

  async function listActiveConnections(teamId: string): Promise<string[]> {
    return findActiveConnectionIds(db, teamId)
  }

  return {
    providers(): GitProviderView[] {
      return [
        {
          providerKey: 'github',
          name: 'GitHub',
          authModes: ['github_app_installation'],
        },
        { providerKey: 'gitea', name: 'Gitea', authModes: ['gitea_token'] },
      ]
    },
    listConnections,
    createConnection,
    completeAuthorization,
    checkConnection,
    syncRepositories,
    revokeConnection,
    listRepositories,
    getAdapterForConnection,
    listActiveConnections,
  }
}

export type IntegrationsService = ReturnType<typeof createIntegrationsService>
