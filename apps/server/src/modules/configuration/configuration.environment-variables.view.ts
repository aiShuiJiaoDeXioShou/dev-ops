import { toCredentialDbStatus, toEnvVarKind, toEnvVarStatus, toEnvironment } from './configuration.validators.ts'
import type { CredentialStatus } from './configuration.validators.ts'
import { toIso } from './configuration.view.ts'

/** 环境变量行投影；plain 的 value_text 只在有权限时作为预览返回。 */
export interface EnvVarRecord {
  id: string
  team_id: string
  project_id: string
  environment: string
  name: string
  kind: string
  value_text: string | null
  credential_id: string | null
  status: string
  version: number
  created_by_user_id: string
  created_at: Date
  updated_at: Date
}

/** 环境变量引用的凭据元数据投影。 */
export interface EnvVarCredentialRecord {
  id: string
  team_id: string
  name: string
  status: string
  current_version: number
  expires_at: Date | null
}

/** 环境变量对应的项目授权投影。 */
export interface EnvVarGrantRecord {
  credential_id: string
  project_id: string
  expires_at: Date | null
  revoked_at: Date | null
}

/** 引用失效原因，供页面区分已撤销、已过期与授权失效。 */
export type EnvVarInvalidReason =
  'credential_missing' | 'credential_revoked' | 'credential_expired' | 'grant_revoked' | 'grant_expired'

/** 环境变量引用的凭据摘要；浏览者看不到该字段。 */
export interface EnvVarCredentialView {
  id: string
  name: string
  currentVersion: number
  status: CredentialStatus
}

/** 环境变量视图；密钥引用不返回明文，浏览者只看到名称与配置状态。 */
export interface EnvVarView {
  id: string
  projectId: string
  environment: ReturnType<typeof toEnvironment>
  name: string
  kind: ReturnType<typeof toEnvVarKind>
  status: ReturnType<typeof toEnvVarStatus>
  version: number
  credential: EnvVarCredentialView | null
  valuePreview: string | null
  masked: boolean
  invalidReason: EnvVarInvalidReason | null
  updatedAt: string
}

/** 环境变量引用校验结果，由服务层在写入与读取时共用。 */
export interface EnvVarReferenceState {
  status: ReturnType<typeof toEnvVarStatus>
  invalidReason: EnvVarInvalidReason | null
  credential: EnvVarCredentialView | null
}

/**
 * 计算密钥引用当前是否可用。
 * @param record 环境变量行；普通变量直接返回 active。
 * @param credentialRecord 被引用凭据；缺失表示凭据已不存在。
 * @param grantRecord 项目授权行；缺失或已撤销表示未授权。
 * @param now 当前时间，用于判断凭据与授权期限。
 * @returns 引用状态、失效原因与凭据摘要；密钥值不参与计算。
 */
export function resolveEnvVarReferenceState(
  record: EnvVarRecord,
  credentialRecord: EnvVarCredentialRecord | undefined,
  grantRecord: EnvVarGrantRecord | undefined,
  now: Date,
): EnvVarReferenceState {
  if (record.kind !== 'credential_ref') return { status: 'active', invalidReason: null, credential: null }
  if (!credentialRecord) {
    return { status: 'invalid', invalidReason: 'credential_missing', credential: null }
  }
  const credentialStatus = toCredentialDbStatus(credentialRecord.status)
  if (credentialStatus === 'revoked') {
    return {
      status: 'invalid',
      invalidReason: 'credential_revoked',
      credential: toCredentialRef(credentialRecord, now),
    }
  }
  if (credentialRecord.expires_at !== null && credentialRecord.expires_at.getTime() <= now.getTime()) {
    return {
      status: 'invalid',
      invalidReason: 'credential_expired',
      credential: toCredentialRef(credentialRecord, now),
    }
  }
  if (!grantRecord || grantRecord.revoked_at !== null) {
    return {
      status: 'invalid',
      invalidReason: 'grant_revoked',
      credential: toCredentialRef(credentialRecord, now),
    }
  }
  if (grantRecord.expires_at !== null && grantRecord.expires_at.getTime() <= now.getTime()) {
    return {
      status: 'invalid',
      invalidReason: 'grant_expired',
      credential: toCredentialRef(credentialRecord, now),
    }
  }
  return { status: 'active', invalidReason: null, credential: toCredentialRef(credentialRecord, now) }
}

/** 映射凭据摘要并派生展示状态。 */
function toCredentialRef(record: EnvVarCredentialRecord, now: Date): EnvVarCredentialView {
  const dbStatus = toCredentialDbStatus(record.status)
  const status: CredentialStatus =
    dbStatus === 'revoked'
      ? 'revoked'
      : record.expires_at !== null && record.expires_at.getTime() <= now.getTime()
        ? 'expired'
        : 'active'
  return { id: record.id, name: record.name, currentVersion: record.current_version, status }
}

/**
 * 将环境变量行映射为响应视图。
 * @param record 环境变量行。
 * @param referenceState 引用状态计算结果；普通变量不展示凭据。
 * @param isViewer 浏览者只能看到名称与配置状态，取值与凭据详情被隐藏。
 * @returns 环境变量视图；密钥引用永远不返回明文。
 */
export function toEnvVarView(
  record: EnvVarRecord,
  referenceState: EnvVarReferenceState,
  isViewer: boolean,
): EnvVarView {
  const isCredentialRef = record.kind === 'credential_ref'
  return {
    id: record.id,
    projectId: record.project_id,
    environment: toEnvironment(record.environment),
    name: record.name,
    kind: toEnvVarKind(record.kind),
    status: referenceState.status,
    version: record.version,
    credential: isViewer ? null : referenceState.credential,
    valuePreview: record.kind === 'plain' && !isViewer ? record.value_text : null,
    masked: isCredentialRef || isViewer,
    invalidReason: referenceState.invalidReason,
    updatedAt: toIso(record.updated_at) ?? '',
  }
}
