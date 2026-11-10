import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import type { ErrorCode } from '../../platform/http/error-codes.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { findCredentialById, findGrant, insertCredentialUsage } from './configuration.credentials.repository.ts'
import {
  deleteEnvVar,
  findCredentialsByIds,
  findEnvVarById,
  findEnvVarByProjectEnvName,
  findGrantsForProject,
  insertEnvVar,
  listEnvVars,
  updateEnvVar,
} from './configuration.environment-variables.repository.ts'
import {
  resolveEnvVarReferenceState,
  toEnvVarView,
  type EnvVarCredentialRecord,
  type EnvVarGrantRecord,
  type EnvVarRecord,
  type EnvVarView,
} from './configuration.environment-variables.view.ts'
import {
  assertPlainValueNotSensitive,
  isUniqueConstraintError,
  validateEnvVarKind,
  validateEnvironment,
  validatePlainValue,
  validateReason,
  validateVariableName,
} from './configuration.validators.ts'

/** 创建环境变量输入；普通变量与密钥引用二选一。 */
export interface CreateEnvVarInput {
  name: string
  kind: string
  value?: string | null
  credentialId?: string | null
}

/** 更新环境变量输入；版本用于乐观锁，密钥引用只保存凭据标识。 */
export interface UpdateEnvVarInput {
  version: number
  name?: string
  value?: string | null
  credentialId?: string | null
}

/** 环境变量服务依赖。 */
export interface EnvironmentVariablesServiceDeps {
  db: Database
}

interface ProjectAccess {
  teamId: string
  role: string
}

/** 引用凭据的写入校验结果，包含用于使用记录版本号的凭据信息。 */
interface CredentialReference {
  credentialId: string
  credentialVersion: number
}

/**
 * 创建项目环境变量服务。
 * @param deps 数据库连接。
 * @returns 三环境环境变量列表、创建、更新与删除用例。
 * @remarks 环境之间不继承；密钥引用只保存凭据标识与变量名，明文永不返回。
 */
export function createEnvironmentVariablesService(deps: EnvironmentVariablesServiceDeps) {
  const { db } = deps

  async function requireProject(actor: SessionUser, projectId: string, write: boolean): Promise<ProjectAccess> {
    const context = await getProjectContext(db, projectId)
    if (!context) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    const membership = await requireTeamMember(db, actor.id, context.teamId, write ? ['admin', 'developer'] : undefined)
    return { teamId: context.teamId, role: membership.role }
  }

  async function loadReferenceState(record: EnvVarRecord) {
    if (record.kind !== 'credential_ref' || record.credential_id === null) {
      return resolveEnvVarReferenceState(record, undefined, undefined, new Date())
    }
    const [credentialRows, grantRows] = await Promise.all([
      findCredentialsByIds(db, [record.credential_id]),
      findGrantsForProject(db, record.project_id, [record.credential_id]),
    ])
    return resolveEnvVarReferenceState(record, credentialRows[0], grantRows[0], new Date())
  }

  async function singleView(record: EnvVarRecord): Promise<EnvVarView> {
    return toEnvVarView(record, await loadReferenceState(record), false)
  }

  async function listVariables(
    actor: SessionUser,
    projectId: string,
    environment: string,
  ): Promise<{ items: EnvVarView[] }> {
    const targetEnvironment = validateEnvironment(environment)
    const access = await requireProject(actor, projectId, false)
    const rows = await listEnvVars(db, projectId, targetEnvironment)
    const credentialIds = [...new Set(rows.flatMap((row) => (row.credential_id === null ? [] : [row.credential_id])))]
    const [credentialRows, grantRows] = await Promise.all([
      findCredentialsByIds(db, credentialIds),
      findGrantsForProject(db, projectId, credentialIds),
    ])
    const credentialMap = new Map<string, EnvVarCredentialRecord>(credentialRows.map((row) => [row.id, row]))
    const grantMap = new Map<string, EnvVarGrantRecord>(grantRows.map((row) => [row.credential_id, row]))
    const now = new Date()
    const isViewer = access.role === 'viewer'
    return {
      items: rows.map((row) =>
        toEnvVarView(
          row,
          resolveEnvVarReferenceState(
            row,
            row.credential_id === null ? undefined : credentialMap.get(row.credential_id),
            row.credential_id === null ? undefined : grantMap.get(row.credential_id),
            now,
          ),
          isViewer,
        ),
      ),
    }
  }

  /**
   * 校验密钥引用可用并记录拒绝审计：凭据必须属于当前团队、有效且已授权当前项目。
   * @returns 凭据标识与当前版本，供成功使用记录引用。
   * @throws 凭据缺失、跨团队、撤销、过期或未授权时抛出业务错误，且不返回明文。
   */
  async function validateCredentialReference(
    teamId: string,
    projectId: string,
    environment: string,
    credentialId: string,
    actorUserId: string,
  ): Promise<CredentialReference> {
    const record = await findCredentialById(db, credentialId)
    if (!record) throw new ApiError(ERROR_CODES.CREDENTIAL_UNAVAILABLE, '凭据不存在或已失效')
    if (record.team_id !== teamId) throw new ApiError(ERROR_CODES.CREDENTIAL_NOT_GRANTED, '不能引用其他团队的凭据')
    const errorCode = await findReferenceErrorCode(record, projectId)
    if (errorCode !== null) {
      // 拒绝也写入使用记录，便于审计越权与失效引用尝试；记录不含明文。
      await insertCredentialUsage(db, {
        id: randomUUID(),
        teamId,
        credentialId,
        credentialVersion: record.current_version,
        projectId,
        environment,
        action: 'use',
        actorUserId,
        result: errorCode === ERROR_CODES.CREDENTIAL_UNAVAILABLE ? 'expired' : 'denied',
        errorCode,
      })
      throw new ApiError(
        errorCode,
        errorCode === ERROR_CODES.CREDENTIAL_UNAVAILABLE ? '凭据已撤销或过期' : '凭据未授权当前项目',
      )
    }
    return { credentialId, credentialVersion: record.current_version }
  }

  /** 返回引用拒绝原因；null 表示当前引用可用。 */
  async function findReferenceErrorCode(
    record: NonNullable<Awaited<ReturnType<typeof findCredentialById>>>,
    projectId: string,
  ): Promise<ErrorCode | null> {
    const now = new Date()
    if (record.status !== 'active') return ERROR_CODES.CREDENTIAL_UNAVAILABLE
    if (record.expires_at !== null && record.expires_at.getTime() <= now.getTime()) {
      return ERROR_CODES.CREDENTIAL_UNAVAILABLE
    }
    const grant = await findGrant(db, record.id, projectId)
    if (!grant || grant.revoked_at !== null) return ERROR_CODES.CREDENTIAL_NOT_GRANTED
    if (grant.expires_at !== null && grant.expires_at.getTime() <= now.getTime()) {
      return ERROR_CODES.CREDENTIAL_UNAVAILABLE
    }
    return null
  }

  /** 记录成功的凭据引用使用记录，与业务写入同事务。 */
  async function recordReferenceUsage(
    executor: Parameters<typeof insertCredentialUsage>[0],
    input: {
      teamId: string
      projectId: string
      environment: string
      reference: CredentialReference
      actorUserId: string
    },
  ) {
    await insertCredentialUsage(executor, {
      id: randomUUID(),
      teamId: input.teamId,
      credentialId: input.reference.credentialId,
      credentialVersion: input.reference.credentialVersion,
      projectId: input.projectId,
      environment: input.environment,
      action: 'use',
      actorUserId: input.actorUserId,
      result: 'success',
      errorCode: null,
    })
  }

  async function createVariable(
    actor: SessionUser,
    projectId: string,
    environment: string,
    input: CreateEnvVarInput,
  ): Promise<EnvVarView> {
    const targetEnvironment = validateEnvironment(environment)
    const access = await requireProject(actor, projectId, true)
    const name = validateVariableName(input.name)
    const kind = validateEnvVarKind(input.kind)
    if (await findEnvVarByProjectEnvName(db, projectId, targetEnvironment, name)) {
      throw new ApiError(ERROR_CODES.ENV_VAR_NAME_DUPLICATE, '同项目同环境已存在同名变量')
    }
    const valueText = kind === 'plain' ? validatePlainVariable(name, input.value) : null
    const reference =
      kind === 'credential_ref'
        ? await validateCredentialReference(
            access.teamId,
            projectId,
            targetEnvironment,
            requireCredentialId(input.credentialId, input.value),
            actor.id,
          )
        : null
    const variableId = randomUUID()
    try {
      await db.transaction(async (tx) => {
        await insertEnvVar(tx, {
          id: variableId,
          teamId: access.teamId,
          projectId,
          environment: targetEnvironment,
          name,
          kind,
          valueText,
          credentialId: reference?.credentialId ?? null,
          createdByUserId: actor.id,
        })
        if (reference) {
          await recordReferenceUsage(tx, {
            teamId: access.teamId,
            projectId,
            environment: targetEnvironment,
            reference,
            actorUserId: actor.id,
          })
        }
        await appendActivity(tx, {
          teamId: access.teamId,
          projectId,
          entityType: 'project_env_var',
          entityId: variableId,
          action: 'env_var_created',
          actorUserId: actor.id,
          changes: { environment: targetEnvironment, kind, credentialId: reference?.credentialId ?? null },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error))
        throw new ApiError(ERROR_CODES.ENV_VAR_NAME_DUPLICATE, '同项目同环境已存在同名变量')
      throw error
    }
    const record = await findEnvVarById(db, variableId)
    if (!record) throw new Error('环境变量创建后读取失败')
    return singleView(record)
  }

  async function updateVariable(actor: SessionUser, variableId: string, input: UpdateEnvVarInput): Promise<EnvVarView> {
    const existing = await findEnvVarById(db, variableId)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '环境变量不存在')
    const access = await requireProject(actor, existing.project_id, true)
    if (input.name === undefined && input.value === undefined && input.credentialId === undefined) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '没有需要更新的字段')
    }
    const nextName = input.name === undefined ? existing.name : validateVariableName(input.name)
    const isCredentialRef = existing.kind === 'credential_ref'
    let nextValueText: string | undefined
    let nextCredentialId: string | undefined
    let reference: CredentialReference | null = null
    if (!isCredentialRef && input.credentialId !== undefined && input.credentialId !== null) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '普通变量不能改为凭据引用')
    }
    if (isCredentialRef && input.value !== undefined && input.value !== null) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据引用不能保存取值')
    }
    if (isCredentialRef && input.credentialId !== undefined) {
      if (input.credentialId === null) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据引用必须指定凭据')
      reference = await validateCredentialReference(
        access.teamId,
        existing.project_id,
        existing.environment,
        input.credentialId,
        actor.id,
      )
      nextCredentialId = reference.credentialId
    }
    if (!isCredentialRef && input.value !== undefined) {
      nextValueText = validatePlainVariable(nextName, input.value)
    }
    if (!isCredentialRef && input.name !== undefined) {
      // 普通变量改名同样需要阻止敏感名称，即使本次未改取值。
      assertPlainValueNotSensitive(nextName, existing.value_text ?? '')
    }
    await db.transaction(async (tx) => {
      const row = await updateEnvVar(tx, variableId, input.version, {
        ...(input.name === undefined ? {} : { name: nextName }),
        ...(nextValueText === undefined ? {} : { valueText: nextValueText }),
        ...(nextCredentialId === undefined ? {} : { credentialId: nextCredentialId }),
        ...(reference === null ? {} : { status: 'active' }),
      })
      if (!row) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '环境变量已被修改，请刷新后重试')
      const changedFields = [
        ...(input.name === undefined ? [] : ['name']),
        ...(nextValueText === undefined ? [] : ['value']),
        ...(nextCredentialId === undefined ? [] : ['credentialId']),
      ]
      if (reference) {
        await recordReferenceUsage(tx, {
          teamId: access.teamId,
          projectId: existing.project_id,
          environment: existing.environment,
          reference,
          actorUserId: actor.id,
        })
      }
      // 活动只记录变更字段名与引用，不记录普通变量取值。
      await appendActivity(tx, {
        teamId: access.teamId,
        projectId: existing.project_id,
        entityType: 'project_env_var',
        entityId: variableId,
        action: 'env_var_updated',
        actorUserId: actor.id,
        changes: { fields: changedFields, credentialId: nextCredentialId ?? null },
      })
    })
    const record = await findEnvVarById(db, variableId)
    if (!record) throw new ApiError(ERROR_CODES.NOT_FOUND, '环境变量不存在')
    return singleView(record)
  }

  async function removeVariable(
    actor: SessionUser,
    variableId: string,
    input: { reason: string },
  ): Promise<{ id: string; removed: true }> {
    const existing = await findEnvVarById(db, variableId)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '环境变量不存在')
    const access = await requireProject(actor, existing.project_id, true)
    const reason = validateReason(input.reason)
    await db.transaction(async (tx) => {
      const row = await deleteEnvVar(tx, variableId)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '环境变量不存在')
      await appendActivity(tx, {
        teamId: access.teamId,
        projectId: existing.project_id,
        entityType: 'project_env_var',
        entityId: variableId,
        action: 'env_var_removed',
        actorUserId: actor.id,
        changes: { environment: existing.environment, kind: existing.kind, name: existing.name },
        reason,
      })
    })
    return { id: variableId, removed: true }
  }

  return {
    listVariables,
    createVariable,
    updateVariable,
    removeVariable,
  }
}

/** 校验普通变量取值并阻止把敏感值保存为普通变量。 */
function validatePlainVariable(name: string, value: string | null | undefined): string {
  if (value === undefined || value === null) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '普通变量必须提供取值')
  }
  const text = validatePlainValue(value)
  assertPlainValueNotSensitive(name, text)
  return text
}

/** 校验密钥引用必须且只能提供凭据标识，不能同时提供取值。 */
function requireCredentialId(credentialId: string | null | undefined, value: string | null | undefined): string {
  if (value !== undefined && value !== null) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据引用不能同时提供取值')
  }
  if (credentialId === undefined || credentialId === null) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据引用必须指定凭据')
  }
  return credentialId
}
