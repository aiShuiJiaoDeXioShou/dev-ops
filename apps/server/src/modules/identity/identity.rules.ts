import { createHash, randomBytes } from 'node:crypto'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { TeamRole } from './identity.session.ts'

/** 邀请默认有效期：7 天（Q02 暂定）。 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const TEAM_ROLES: ReadonlySet<string> = new Set(['admin', 'developer', 'viewer'])
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 归一化并校验邮箱。 */
export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase()
  if (value.length > 320 || !EMAIL_PATTERN.test(value)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '邮箱格式不合法')
  }
  return value
}

/** 去除团队名称首尾空白并校验长度。 */
export function normalizeTeamName(name: string): string {
  const value = name.trim()
  if (value.length === 0 || value.length > 120) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '团队名称长度必须在 1-120 个字符之间')
  }
  return value
}

/** 判断字符串是否为团队角色。 */
export function isTeamRole(value: string): value is TeamRole {
  return TEAM_ROLES.has(value)
}

/** 校验团队角色。 */
export function normalizeRole(role: string): TeamRole {
  if (!isTeamRole(role)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '团队角色不合法')
  return role
}

/** 将数据库团队角色收窄为业务类型；数据不合法时说明是持久化异常。 */
export function toTeamRole(value: string): TeamRole {
  if (!isTeamRole(value)) throw new Error(`数据库团队角色不合法: ${value}`)
  return value
}

/** 计算邀请 token 的 SHA-256 哈希。 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 生成一次性邀请 token。 */
export function createInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 判断 PostgreSQL 唯一约束冲突；统一从平台数据库工具导入，避免各模块重复实现。 */
export { isUniqueViolation } from '../../platform/database/errors.ts'

/**
 * 判断成员更新是否会移除最后一位正常管理员。
 * @param currentRole 当前角色。
 * @param currentStatus 当前状态。
 * @param input 目标角色/状态。
 * @param activeAdminCount 团队当前正常管理员数量。
 * @returns 是否应阻断。
 */
export function wouldRemoveLastAdmin(
  currentRole: string,
  currentStatus: string,
  input: { role?: string; status?: string },
  activeAdminCount: number,
): boolean {
  const removingAdmin =
    currentRole === 'admin' &&
    currentStatus === 'active' &&
    ((input.role !== undefined && input.role !== 'admin') || (input.status !== undefined && input.status !== 'active'))
  return removingAdmin && activeAdminCount <= 1
}
