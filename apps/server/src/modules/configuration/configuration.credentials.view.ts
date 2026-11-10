import { toEnvironment } from './configuration.validators.ts'
import { toIso } from './configuration.view.ts'
import {
  toCredentialDbStatus,
  toCredentialKind,
  toUsageAction,
  toUsageResult,
  type CredentialKind,
  type CredentialStatus,
  type CredentialUsageAction,
  type CredentialUsageResult,
  type Environment,
} from './configuration.validators.ts'

/** 列表与详情固定返回的掩码；真实值只在密码二次确认后的查看接口单独返回。 */
const MASKED_CREDENTIAL_VALUE = '••••••••'

/** 凭据元数据行投影；密文保存在版本表，本投影不含密文。 */
export interface CredentialRecord {
  id: string
  team_id: string
  name: string
  kind: string
  description: string | null
  status: string
  current_version: number
  expires_at: Date | null
  created_by_user_id: string
  created_at: Date
  updated_at: Date
}

/** 凭据授权行投影。 */
export interface CredentialGrantRecord {
  project_id: string
  expires_at: Date | null
  revoked_at: Date | null
}

/** 凭据使用记录行投影。 */
export interface CredentialUsageRecord {
  id: string
  credential_id: string
  credential_version: number
  project_id: string | null
  environment: string | null
  action: string
  actor_user_id: string | null
  result: string
  error_code: string | null
  created_at: Date
}

/** 凭据对项目的授权视图；撤销后保留 revokedAt 供追溯。 */
export interface CredentialGrantView {
  projectId: string
  projectName: string
  expiresAt: string | null
  revokedAt: string | null
}

/** 凭据视图：只含元数据、授权与掩码，不返回明文。 */
export interface CredentialView {
  id: string
  teamId: string
  name: string
  kind: CredentialKind
  description: string | null
  status: CredentialStatus
  currentVersion: number
  expiresAt: string | null
  grants: CredentialGrantView[]
  maskedValue: string
  createdAt: string
  updatedAt: string
}

/** 凭据使用记录视图；不包含密钥值。 */
export interface CredentialUsageView {
  id: string
  credentialId: string
  credentialVersion: number
  projectId: string | null
  environment: Environment | null
  action: CredentialUsageAction
  actorUserId: string | null
  result: CredentialUsageResult
  errorCode: string | null
  createdAt: string
}

/** 凭据详情视图：在元数据之外附带最近使用摘要。 */
export interface CredentialDetailView extends CredentialView {
  recentUsage: CredentialUsageView[]
}

/** 明文查看视图：仅在通过二次密码确认后返回一次，不进入列表、详情或审计记录。 */
export interface CredentialRevealView {
  value: string
  version: number
  revealedAt: string
}

/**
 * 派生凭据对外状态：撤销优先，其次按 expires_at 判断过期，其余为 active。
 * @param record 凭据元数据行。
 * @param now 当前时间，测试可注入固定值。
 * @returns 展示用状态 active／revoked／expired。
 */
function effectiveCredentialStatus(record: CredentialRecord, now: Date): CredentialStatus {
  const status = toCredentialDbStatus(record.status)
  if (status === 'revoked') return 'revoked'
  if (record.expires_at !== null && record.expires_at.getTime() <= now.getTime()) return 'expired'
  return 'active'
}

/**
 * 将数据库授权行与项目名称映射为响应视图。
 * @param grants 授权行，需包含凭据标识以便列表批量映射。
 * @param projectNames 项目标识到名称的映射；缺失时回退为未知项目。
 * @returns 状态为 revoked 的行仍返回，展示层据此区分已撤销授权。
 */
export function toGrantViews(
  grants: Array<CredentialGrantRecord & { credential_id: string }>,
  projectNames: Map<string, string>,
): Map<string, CredentialGrantView[]> {
  const result = new Map<string, CredentialGrantView[]>()
  for (const grant of grants) {
    const item: CredentialGrantView = {
      projectId: grant.project_id,
      projectName: projectNames.get(grant.project_id) ?? '未知项目',
      expiresAt: toIso(grant.expires_at),
      revokedAt: toIso(grant.revoked_at),
    }
    const list = result.get(grant.credential_id) ?? []
    list.push(item)
    result.set(grant.credential_id, list)
  }
  return result
}

/**
 * 将凭据行映射为响应视图。
 * @param record 凭据元数据行。
 * @param grants 该凭据的授权视图列表。
 * @param now 当前时间，用于派生过期状态。
 * @returns 仅含元数据与掩码的凭据视图。
 */
export function toCredentialView(record: CredentialRecord, grants: CredentialGrantView[], now: Date): CredentialView {
  return {
    id: record.id,
    teamId: record.team_id,
    name: record.name,
    kind: toCredentialKind(record.kind),
    description: record.description,
    status: effectiveCredentialStatus(record, now),
    currentVersion: record.current_version,
    expiresAt: toIso(record.expires_at),
    grants,
    maskedValue: MASKED_CREDENTIAL_VALUE,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  }
}

/**
 * 将使用记录行映射为响应视图。
 * @param record 使用记录行。
 * @returns 不含密钥值的审计视图。
 * @throws 数据库动作或结果枚举不合法时抛出普通错误，说明是持久化异常。
 */
export function toCredentialUsageView(record: CredentialUsageRecord): CredentialUsageView {
  return {
    id: record.id,
    credentialId: record.credential_id,
    credentialVersion: record.credential_version,
    projectId: record.project_id,
    environment: record.environment === null ? null : toEnvironment(record.environment),
    action: toUsageAction(record.action),
    actorUserId: record.actor_user_id,
    result: toUsageResult(record.result),
    errorCode: record.error_code,
    createdAt: record.created_at.toISOString(),
  }
}
