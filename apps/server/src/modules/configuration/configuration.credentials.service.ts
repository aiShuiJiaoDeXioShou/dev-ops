import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES, type ErrorCode } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import type { Actor } from '../identity/identity.actor.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import type { SecretCipher } from './configuration.crypto.ts'
import {
  countActiveGrants,
  countRecentCredentialRevealAttempts,
  findActiveGrantProjectIds,
  findActiveGrantedCredentialIds,
  findCredentialById,
  findCredentialByName,
  findCredentialVersionCiphertext,
  findProjectRefById,
  findProjectRefsByIds,
  insertCredential,
  insertCredentialUsage,
  insertCredentialVersion,
  listCredentialUsage,
  listCredentials,
  listGrantsForCredentials,
  listRecentCredentialUsage,
  lockCredentialForUpdate,
  revokeGrant,
  updateCredentialCurrentVersion,
  updateCredentialStatus,
  upsertGrant,
} from './configuration.credentials.repository.ts'
import {
  toCredentialUsageView,
  toCredentialView,
  toGrantViews,
  type CredentialDetailView,
  type CredentialGrantView,
  type CredentialRevealView,
  type CredentialUsageView,
  type CredentialView,
} from './configuration.credentials.view.ts'
import {
  markEnvVarsInvalidForCredential,
  markEnvVarsInvalidForCredentialInProject,
  restoreEnvVarsForCredentialInProject,
} from './configuration.environment-variables.repository.ts'
import {
  isUniqueConstraintError,
  optionalText,
  requireText,
  validateCredentialKind,
  validateCredentialValue,
  validateFutureTimestamp,
  validateReason,
} from './configuration.validators.ts'
import { toPageResult, type PageResult } from './configuration.view.ts'

/** 凭据创建时的项目授权输入。 */
export interface CredentialGrantInput {
  projectId: string
  expiresAt?: string | null
}

/** 创建凭据输入；明文只存在于请求体，加密后不再保留。 */
export interface CreateCredentialInput {
  name: string
  kind: string
  description?: string | null
  value: string
  expiresAt?: string | null
  projectGrants?: CredentialGrantInput[]
}

/** 轮换凭据输入；只替换密文，保持凭据标识与引用不变。 */
export interface RotateCredentialInput {
  value: string
  reason?: string | null
}

/** 凭据列表筛选与分页条件。 */
export interface CredentialListFilters {
  kind?: string
  status?: string
  search?: string
  page: number
  pageSize: number
}

/** 凭据服务依赖：数据库连接、AES-256-GCM 加解密器与会话密码二次校验。 */
export interface CredentialsServiceDeps {
  db: Database
  cipher: SecretCipher
  verifyPassword: (headers: IncomingHttpHeaders, password: string) => Promise<boolean>
}

/** 可查看凭据明文的团队角色；调整权限时必须同步更新契约文档与角色矩阵测试。 */
export const CREDENTIAL_VALUE_VIEW_ROLES: readonly TeamRole[] = ['admin', 'developer']

/** 明文查看的二次验证输入；密码只用于本次校验，不落库、不写日志。 */
export interface RevealCredentialInput {
  password: string
  headers: IncomingHttpHeaders
}

const RECENT_USAGE_LIMIT = 5
/** 同一用户 5 分钟内最多尝试查看明文的次数，成功与失败都计入。 */
const REVEAL_ATTEMPT_LIMIT = 10
const REVEAL_ATTEMPT_WINDOW_MS = 5 * 60_000
const CREDENTIAL_STATUS_FILTERS: ReadonlySet<string> = new Set(['active', 'revoked'])

/**
 * 创建凭据库服务。
 * @param deps 数据库连接、加解密器与会话密码校验依赖。
 * @returns 凭据创建、列表、详情、轮换、撤销、项目授权、使用记录与明文查看用例。
 * @remarks 列表和详情只含元数据与掩码；明文只在密码二次确认后的查看响应中出现，
 * 不进入日志、活动或使用记录。查看动作本身会写入审计记录。
 */
export function createCredentialsService(deps: CredentialsServiceDeps) {
  const { db } = deps

  async function requireCredential(credentialId: string) {
    const record = await findCredentialById(db, credentialId)
    if (!record) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在')
    return record
  }

  async function requireAdmin(actor: SessionUser, teamId: string) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
  }

  async function loadGrantViews(credentialIds: string[]): Promise<Map<string, CredentialGrantView[]>> {
    const grants = await listGrantsForCredentials(db, credentialIds)
    const projectIds = [...new Set(grants.map((grant) => grant.project_id))]
    const projectRefs = await findProjectRefsByIds(db, projectIds)
    return toGrantViews(grants, new Map(projectRefs.map((ref) => [ref.id, ref.name])))
  }

  async function singleView(credentialId: string): Promise<CredentialView> {
    const record = await requireCredential(credentialId)
    const grants = await loadGrantViews([credentialId])
    return toCredentialView(record, grants.get(credentialId) ?? [], new Date())
  }

  async function detailView(credentialId: string): Promise<CredentialDetailView> {
    const view = await singleView(credentialId)
    const recentUsage = await listRecentCredentialUsage(db, credentialId, RECENT_USAGE_LIMIT)
    return { ...view, recentUsage: recentUsage.map(toCredentialUsageView) }
  }

  /** 校验授权项目属于凭据所在团队，并拒绝重复授权。 */
  async function validateGrantInputs(teamId: string, inputs: CredentialGrantInput[]) {
    const seen = new Set<string>()
    const result: Array<{ projectId: string; expiresAt: Date | null }> = []
    for (const input of inputs) {
      if (seen.has(input.projectId)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '项目授权重复')
      seen.add(input.projectId)
      const projectRef = await findProjectRefById(db, input.projectId)
      if (!projectRef) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
      if (projectRef.teamId !== teamId) throw new ApiError(ERROR_CODES.FORBIDDEN, '只能授权本团队项目')
      result.push({ projectId: projectRef.id, expiresAt: validateFutureTimestamp(input.expiresAt, '授权期限') })
    }
    return result
  }

  async function createCredential(
    actor: SessionUser,
    teamId: string,
    input: CreateCredentialInput,
  ): Promise<CredentialView> {
    await requireAdmin(actor, teamId)
    const name = requireText(input.name, '凭据名称', 120)
    const kind = validateCredentialKind(input.kind)
    const description = optionalText(input.description, '凭据说明', 1000)
    const value = validateCredentialValue(input.value)
    const expiresAt = validateFutureTimestamp(input.expiresAt, '凭据有效期')
    const grants = await validateGrantInputs(teamId, input.projectGrants ?? [])
    if (await findCredentialByName(db, teamId, name)) {
      throw new ApiError(ERROR_CODES.CREDENTIAL_NAME_DUPLICATE, '同团队已存在同名凭据')
    }
    const encrypted = deps.cipher.encrypt(value)
    const credentialId = randomUUID()
    try {
      await db.transaction(async (tx) => {
        await insertCredential(tx, {
          id: credentialId,
          teamId,
          name,
          kind,
          description,
          expiresAt,
          createdByUserId: actor.id,
        })
        await insertCredentialVersion(tx, {
          id: randomUUID(),
          teamId,
          credentialId,
          version: 1,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          rotatedFromVersion: null,
          createdByUserId: actor.id,
        })
        await insertCredentialUsage(tx, {
          id: randomUUID(),
          teamId,
          credentialId,
          credentialVersion: 1,
          projectId: null,
          environment: null,
          action: 'create',
          actorUserId: actor.id,
          result: 'success',
          errorCode: null,
        })
        await appendActivity(tx, {
          teamId,
          entityType: 'credential',
          entityId: credentialId,
          action: 'credential_created',
          actorUserId: actor.id,
          changes: { kind, name, expiresAt: expiresAt?.toISOString() ?? null },
        })
        for (const grant of grants) {
          const row = await upsertGrant(tx, {
            id: randomUUID(),
            teamId,
            credentialId,
            projectId: grant.projectId,
            expiresAt: grant.expiresAt,
            grantedByUserId: actor.id,
          })
          await insertCredentialUsage(tx, {
            id: randomUUID(),
            teamId,
            credentialId,
            credentialVersion: 1,
            projectId: grant.projectId,
            environment: null,
            action: 'grant',
            actorUserId: actor.id,
            result: 'success',
            errorCode: null,
          })
          await appendActivity(tx, {
            teamId,
            projectId: grant.projectId,
            entityType: 'credential_grant',
            entityId: row.id,
            action: 'credential_granted',
            actorUserId: actor.id,
            changes: { credentialId, expiresAt: grant.expiresAt?.toISOString() ?? null },
          })
        }
      })
    } catch (error) {
      if (isUniqueConstraintError(error))
        throw new ApiError(ERROR_CODES.CREDENTIAL_NAME_DUPLICATE, '同团队已存在同名凭据')
      throw error
    }
    return singleView(credentialId)
  }

  async function listTeamCredentials(
    actor: SessionUser,
    teamId: string,
    filters: CredentialListFilters,
  ): Promise<PageResult<CredentialView>> {
    const membership = await requireTeamMember(db, actor.id, teamId, ['admin', 'developer'])
    validatePage(filters.page, filters.pageSize)
    if (filters.kind !== undefined) validateCredentialKind(filters.kind)
    if (filters.status !== undefined && !CREDENTIAL_STATUS_FILTERS.has(filters.status)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据状态筛选不合法')
    }
    // 开发者只能看到已授权给团队项目的凭据元数据；浏览者无权访问凭据库。
    const visibleIds = membership.role === 'developer' ? await findActiveGrantedCredentialIds(db, teamId) : undefined
    const { rows, total } = await listCredentials(
      db,
      teamId,
      {
        kind: filters.kind,
        status: filters.status,
        search: optionalText(filters.search, '搜索关键字', 200) ?? undefined,
        page: filters.page,
        pageSize: filters.pageSize,
      },
      visibleIds,
    )
    const grantViews = await loadGrantViews(rows.map((row) => row.id))
    const now = new Date()
    return toPageResult(
      rows.map((row) => toCredentialView(row, grantViews.get(row.id) ?? [], now)),
      filters.page,
      filters.pageSize,
      total,
    )
  }

  async function getCredential(
    actor: SessionUser,
    teamId: string,
    credentialId: string,
  ): Promise<CredentialDetailView> {
    const record = await requireCredential(credentialId)
    if (record.team_id !== teamId) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在')
    const membership = await requireTeamMember(db, actor.id, teamId, ['admin', 'developer'])
    if (membership.role === 'developer' && (await countActiveGrants(db, credentialId)) === 0) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, '无权查看该凭据')
    }
    return detailView(credentialId)
  }

  async function rotateCredential(
    actor: SessionUser,
    credentialId: string,
    input: RotateCredentialInput,
  ): Promise<CredentialView> {
    const record = await requireCredential(credentialId)
    await requireAdmin(actor, record.team_id)
    const value = validateCredentialValue(input.value)
    const reason = optionalText(input.reason, '原因', 1000)
    const encrypted = deps.cipher.encrypt(value)
    await db.transaction(async (tx) => {
      const locked = await lockCredentialForUpdate(tx, credentialId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在')
      if (locked.status !== 'active') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '凭据已撤销，不能轮换')
      const nextVersion = locked.current_version + 1
      const updated = await updateCredentialCurrentVersion(tx, credentialId, locked.current_version, {
        currentVersion: nextVersion,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '凭据版本已变化，请刷新后重试')
      await insertCredentialVersion(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        version: nextVersion,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        rotatedFromVersion: locked.current_version,
        createdByUserId: actor.id,
      })
      await insertCredentialUsage(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        credentialVersion: nextVersion,
        projectId: null,
        environment: null,
        action: 'rotate',
        actorUserId: actor.id,
        result: 'success',
        errorCode: null,
      })
      await appendActivity(tx, {
        teamId: record.team_id,
        entityType: 'credential',
        entityId: credentialId,
        action: 'credential_rotated',
        actorUserId: actor.id,
        changes: { fromVersion: locked.current_version, toVersion: nextVersion },
        reason: reason ?? undefined,
      })
    })
    return singleView(credentialId)
  }

  async function revokeCredential(
    actor: SessionUser,
    credentialId: string,
    input: { reason: string },
  ): Promise<CredentialView> {
    const record = await requireCredential(credentialId)
    await requireAdmin(actor, record.team_id)
    const reason = validateReason(input.reason)
    await db.transaction(async (tx) => {
      const locked = await lockCredentialForUpdate(tx, credentialId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在')
      if (locked.status !== 'active') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '凭据已撤销')
      const updated = await updateCredentialStatus(tx, credentialId, 'active', 'revoked')
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '凭据状态已变化，请刷新后重试')
      // 撤销后相关引用立即失效，历史使用记录保持可追溯。
      await markEnvVarsInvalidForCredential(tx, credentialId)
      await insertCredentialUsage(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        credentialVersion: locked.current_version,
        projectId: null,
        environment: null,
        action: 'revoke',
        actorUserId: actor.id,
        result: 'success',
        errorCode: null,
      })
      await appendActivity(tx, {
        teamId: record.team_id,
        entityType: 'credential',
        entityId: credentialId,
        action: 'credential_revoked',
        actorUserId: actor.id,
        changes: { status: 'revoked' },
        reason,
      })
    })
    return singleView(credentialId)
  }

  async function grantProject(
    actor: SessionUser,
    credentialId: string,
    input: CredentialGrantInput,
  ): Promise<CredentialView> {
    const record = await requireCredential(credentialId)
    await requireAdmin(actor, record.team_id)
    const expiresAt = validateFutureTimestamp(input.expiresAt, '授权期限')
    const projectRef = await findProjectRefById(db, input.projectId)
    if (!projectRef) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    if (projectRef.teamId !== record.team_id) throw new ApiError(ERROR_CODES.FORBIDDEN, '只能授权本团队项目')
    await db.transaction(async (tx) => {
      const locked = await lockCredentialForUpdate(tx, credentialId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在')
      if (locked.status !== 'active') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '凭据已撤销，不能授权')
      const row = await upsertGrant(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        projectId: projectRef.id,
        expiresAt,
        grantedByUserId: actor.id,
      })
      // 恢复授权后重新配置的引用应恢复可用状态。
      await restoreEnvVarsForCredentialInProject(tx, credentialId, projectRef.id)
      await insertCredentialUsage(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        credentialVersion: locked.current_version,
        projectId: projectRef.id,
        environment: null,
        action: 'grant',
        actorUserId: actor.id,
        result: 'success',
        errorCode: null,
      })
      await appendActivity(tx, {
        teamId: record.team_id,
        projectId: projectRef.id,
        entityType: 'credential_grant',
        entityId: row.id,
        action: 'credential_granted',
        actorUserId: actor.id,
        changes: { credentialId, expiresAt: expiresAt?.toISOString() ?? null },
      })
    })
    return singleView(credentialId)
  }

  async function revokeProjectGrant(
    actor: SessionUser,
    credentialId: string,
    projectId: string,
    input: { reason: string },
  ): Promise<CredentialView> {
    const record = await requireCredential(credentialId)
    await requireAdmin(actor, record.team_id)
    const reason = validateReason(input.reason)
    await db.transaction(async (tx) => {
      const locked = await lockCredentialForUpdate(tx, credentialId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在')
      const row = await revokeGrant(tx, credentialId, projectId)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '授权不存在或已撤销')
      // 授权缩小后该项目内引用必须立即失效，但不改变历史使用记录。
      await markEnvVarsInvalidForCredentialInProject(tx, credentialId, projectId)
      await insertCredentialUsage(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        credentialVersion: locked.current_version,
        projectId,
        environment: null,
        action: 'revoke_grant',
        actorUserId: actor.id,
        result: 'success',
        errorCode: null,
      })
      await appendActivity(tx, {
        teamId: record.team_id,
        projectId,
        entityType: 'credential_grant',
        entityId: row.id,
        action: 'credential_grant_revoked',
        actorUserId: actor.id,
        changes: { credentialId },
        reason,
      })
    })
    return singleView(credentialId)
  }

  async function listUsage(
    actor: SessionUser,
    credentialId: string,
    filters: { page: number; pageSize: number },
  ): Promise<PageResult<CredentialUsageView>> {
    const record = await requireCredential(credentialId)
    const membership = await requireTeamMember(db, actor.id, record.team_id, ['admin', 'developer'])
    validatePage(filters.page, filters.pageSize)
    let projectIds: string[] | undefined
    if (membership.role === 'developer') {
      projectIds = await findActiveGrantProjectIds(db, credentialId)
      if (projectIds.length === 0) throw new ApiError(ERROR_CODES.FORBIDDEN, '无权查看该凭据使用记录')
    }
    const { rows, total } = await listCredentialUsage(db, credentialId, {
      projectIds,
      page: filters.page,
      pageSize: filters.pageSize,
    })
    return toPageResult(rows.map(toCredentialUsageView), filters.page, filters.pageSize, total)
  }

  /** 记录一次明文查看尝试；只写引用、版本与结果，不写密码或明文。 */
  async function recordRevealAttempt(
    record: { id: string; team_id: string; current_version: number },
    actorUserId: string,
    result: 'denied' | 'expired',
    errorCode: ErrorCode,
  ) {
    await insertCredentialUsage(db, {
      id: randomUUID(),
      teamId: record.team_id,
      credentialId: record.id,
      credentialVersion: record.current_version,
      projectId: null,
      environment: null,
      action: 'reveal',
      actorUserId,
      result,
      errorCode,
    })
  }

  /**
   * 输入本人登录密码后查看凭据当前版本明文。
   * @param actor 当前操作身份；必须是登录会话，API Token 被拒绝。
   * @param credentialId 凭据标识。
   * @param input 本次输入的登录密码与原始请求头；密码只用于校验，不落库。
   * @returns 当前版本明文、版本号与查看时间；明文只在本次响应出现。
   * @throws 无权限或非会话身份抛 FORBIDDEN；密码错误抛 PASSWORD_INVALID；
   * 尝试过于频繁抛 RATE_LIMITED；凭据已撤销或过期抛 CREDENTIAL_UNAVAILABLE。
   * @remarks 成功与失败尝试都写入使用记录，成功查看同时写入活动；两者都不包含明文。
   */
  async function revealCredentialValue(
    actor: Actor,
    credentialId: string,
    input: RevealCredentialInput,
  ): Promise<CredentialRevealView> {
    // 二次密码确认依赖登录会话；API Token 不能代替用户本人确认。
    if (actor.credential !== 'session') {
      throw new ApiError(ERROR_CODES.FORBIDDEN, '查看凭据值需要登录会话，不能使用 API Token')
    }
    const record = await requireCredential(credentialId)
    const membership = await requireTeamMember(db, actor.user.id, record.team_id, [...CREDENTIAL_VALUE_VIEW_ROLES])
    // 开发者只能查看已授权条目的明文，与管理端可见范围保持一致。
    if (membership.role === 'developer' && (await countActiveGrants(db, credentialId)) === 0) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, '无权查看该凭据')
    }
    const since = new Date(Date.now() - REVEAL_ATTEMPT_WINDOW_MS)
    if ((await countRecentCredentialRevealAttempts(db, actor.user.id, since)) >= REVEAL_ATTEMPT_LIMIT) {
      throw new ApiError(ERROR_CODES.RATE_LIMITED, '查看凭据值过于频繁，请稍后再试')
    }
    if (!(await deps.verifyPassword(input.headers, input.password))) {
      await recordRevealAttempt(record, actor.user.id, 'denied', ERROR_CODES.PASSWORD_INVALID)
      throw new ApiError(ERROR_CODES.PASSWORD_INVALID, '登录密码错误，无法查看凭据值')
    }
    const now = new Date()
    if (record.status !== 'active' || (record.expires_at !== null && record.expires_at.getTime() <= now.getTime())) {
      await recordRevealAttempt(record, actor.user.id, 'expired', ERROR_CODES.CREDENTIAL_UNAVAILABLE)
      throw new ApiError(ERROR_CODES.CREDENTIAL_UNAVAILABLE, '凭据已撤销或已过期')
    }
    const version = await findCredentialVersionCiphertext(db, credentialId, record.current_version)
    if (!version) throw new Error('数据库缺少凭据当前版本密文')
    const value = deps.cipher.decrypt({
      ciphertext: version.ciphertext,
      iv: version.iv,
      authTag: version.auth_tag,
      keyVersion: version.key_version,
    })
    await db.transaction(async (tx) => {
      await insertCredentialUsage(tx, {
        id: randomUUID(),
        teamId: record.team_id,
        credentialId,
        credentialVersion: record.current_version,
        projectId: null,
        environment: null,
        action: 'reveal',
        actorUserId: actor.user.id,
        result: 'success',
        errorCode: null,
      })
      await appendActivity(tx, {
        teamId: record.team_id,
        entityType: 'credential',
        entityId: credentialId,
        action: 'credential_revealed',
        actorUserId: actor.user.id,
        changes: { version: record.current_version },
      })
    })
    return { value, version: record.current_version, revealedAt: now.toISOString() }
  }

  return {
    createCredential,
    listCredentials: listTeamCredentials,
    getCredential,
    rotateCredential,
    revokeCredential,
    grantProject,
    revokeProjectGrant,
    listUsage,
    revealCredentialValue,
  }
}
