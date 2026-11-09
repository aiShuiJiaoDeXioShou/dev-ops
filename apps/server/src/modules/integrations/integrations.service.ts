import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AppConfig } from '../../platform/config/env.js'
import type { Database } from '../../platform/database/client.js'
import { ApiError } from '../../platform/http/errors.js'
import { ERROR_CODES } from '../../platform/http/error-codes.js'
import { requireTeamMember, type SessionUser } from '../identity/public.js'
import type { ConfigurationService } from '../configuration/public.js'
import { findConnectionRepositories, markRepositoriesUnavailable, upsertGitRepositories } from '../code/public.js'
import {
  findActiveConnectionIds,
  findGitConnectionById,
  findGitConnections,
  insertGitConnection,
  updateGitConnection,
} from './integrations.repository.js'

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
export type GitAdapterFactory = (
  connection: Awaited<ReturnType<typeof findGitConnectionById>> & object,
) => Promise<GitReadAdapter>

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

function signState(payload: { teamId: string; userId: string; exp: number }, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

function verifyState(state: string, secret: string): { teamId: string; userId: string; exp: number } {
  const [body, signature] = state.split('.')
  if (!body || !signature) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  }
  let payload: { teamId?: unknown; userId?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof payload
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  }
  if (typeof payload.teamId !== 'string' || typeof payload.userId !== 'string' || typeof payload.exp !== 'number') {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 不合法')
  }
  if (payload.exp * 1000 <= Date.now()) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '授权 state 已过期')
  return { teamId: payload.teamId, userId: payload.userId, exp: payload.exp }
}

/**
 * 创建 Git 连接集成服务。
 * @param deps 数据库、应用配置、凭据服务与可选适配器工厂。
 * @returns 连接创建/检查/同步/撤权、授权 state 与适配器解析。
 */
export function createIntegrationsService(deps: IntegrationsServiceDeps) {
  const { db, config } = deps

  function requireConfiguration(): ConfigurationService {
    if (!deps.configuration) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '凭据加密尚未配置')
    return deps.configuration
  }

  function adapterFor(
    connection: NonNullable<Awaited<ReturnType<typeof findGitConnectionById>>>,
  ): Promise<GitReadAdapter> {
    if (!deps.adapterFactory) return Promise.reject(new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Git 适配器未装配'))
    return deps.adapterFactory(connection)
  }

  async function requireConnectionAdmin(actor: SessionUser, connectionId: string) {
    const connection = await findGitConnectionById(db, connectionId)
    if (!connection) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Git 连接不存在')
    await requireTeamMember(db, actor.id, connection.team_id, ['admin'])
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
        externalIdentity: identity.identity,
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
      if (config.GITHUB_AUTH_MODE === 'app') {
        if (!config.GITHUB_APP_SLUG) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'GitHub App 未配置')
        if (!config.AUTH_SECRET) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'AUTH_SECRET 未配置')
        const exp = Math.floor(Date.now() / 1000) + 600
        const state = signState({ teamId, userId: actor.id, exp }, config.AUTH_SECRET)
        return {
          authorizationUrl: `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`,
          expiresAt: new Date(exp * 1000).toISOString(),
        }
      }
      const row = await insertGitConnection(db, {
        id: randomUUID(),
        teamId,
        providerKey: 'github',
        instanceUrl: 'https://github.com',
        name,
        authKind: 'github_cli',
        secretId: null,
        externalIdentity: null,
        createdByUserId: actor.id,
      })
      if (!row) throw new Error('Git 连接创建失败')
      await checkAndSync(row)
      const refreshed = await findGitConnectionById(db, row.id)
      return view(refreshed ?? row)
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

  async function completeAuthorization(
    actor: SessionUser,
    providerKey: string,
    state: string,
    installationId: number,
  ): Promise<GitConnectionView> {
    if (providerKey !== 'github') throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '不支持的 Git 提供方')
    if (!config.AUTH_SECRET) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'AUTH_SECRET 未配置')
    const payload = verifyState(state, config.AUTH_SECRET)
    if (payload.userId !== actor.id) throw new ApiError(ERROR_CODES.FORBIDDEN, '授权发起人不匹配')
    await requireTeamMember(db, actor.id, payload.teamId, ['admin'])
    if (!Number.isSafeInteger(installationId) || installationId <= 0)
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '安装 ID 不合法')
    const row = await insertGitConnection(db, {
      id: randomUUID(),
      teamId: payload.teamId,
      providerKey: 'github',
      instanceUrl: 'https://github.com',
      name: `GitHub App ${installationId}`,
      authKind: 'github_app_installation',
      secretId: null,
      externalIdentity: String(installationId),
      createdByUserId: actor.id,
    })
    if (!row) throw new Error('Git 连接创建失败')
    await checkAndSync(row)
    const refreshed = await findGitConnectionById(db, row.id)
    return view(refreshed ?? row)
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
          authModes: config.GITHUB_AUTH_MODE === 'app' ? ['github_app_installation'] : ['github_cli'],
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
