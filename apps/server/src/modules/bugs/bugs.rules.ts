import { ApiError } from '../../platform/http/errors.js'
import { ERROR_CODES } from '../../platform/http/error-codes.js'

export type BugStatus = 'pending' | 'in_fix' | 'in_regression' | 'resolved' | 'closed'
export type CloseReason = 'duplicate' | 'not_bug' | 'wont_fix'
export const BUG_STATUSES: ReadonlySet<BugStatus> = new Set([
  'pending',
  'in_fix',
  'in_regression',
  'resolved',
  'closed',
])
export const EDITABLE_BUG_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_fix'])
export const CLOSE_REASONS: ReadonlySet<CloseReason> = new Set(['duplicate', 'not_bug', 'wont_fix'])

/** 归一化 Bug 标题并校验长度。 */
export function normalizeBugTitle(title: string): string {
  const value = title.trim()
  if (value.length === 0 || value.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Bug 标题长度必须在 1-200 个字符之间')
  }
  return value
}

/** 校验必填长文本。 */
export function requiredText(value: string, name: string, maxLength = 20_000): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

/** 校验原因/结论等短文本。 */
export function reasonText(value: string, name: string): string {
  return requiredText(value, name, 2000)
}

/** 校验可选文本，空字符串归一为 null。 */
export function optionalText(value: string | null | undefined, name: string, maxLength = 20_000): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  if (trimmed.length > maxLength)
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不能超过 ${maxLength} 个字符`)
  return trimmed.length === 0 ? null : trimmed
}

/** 校验证据外链，仅允许 HTTP/HTTPS。 */
export function optionalHttpUrl(value: string | null | undefined, name = '证据链接'): string | null {
  if (value === undefined || value === null) return null
  const url = value.trim()
  if (url.length === 0) return null
  if (url.length > 2048) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不能超过 2048 个字符`)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不合法`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}仅支持 HTTP/HTTPS`)
  }
  return url
}

/** 校验复现信息：明确未知时可为空，否则必须非空。 */
export function validateReproduction(
  reproduction: string | null | undefined,
  unknown: boolean,
): { reproduction: string | null; reproductionUnknown: boolean } {
  const text = reproduction?.trim() ?? ''
  if (unknown) return { reproduction: null, reproductionUnknown: true }
  if (text.length === 0 || text.length > 20_000) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '复现信息长度必须在 1-20000 个字符之间，或明确标注无法稳定复现')
  }
  return { reproduction: text, reproductionUnknown: false }
}

/** 校验 Bug 状态。 */
export function validateBugStatus(status: string): BugStatus {
  if (!BUG_STATUSES.has(status as BugStatus)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Bug 状态不合法')
  return status as BugStatus
}

/** 校验关闭原因。 */
export function validateCloseReason(reason: string): CloseReason {
  if (!CLOSE_REASONS.has(reason as CloseReason)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关闭原因不合法')
  return reason as CloseReason
}

/** 校验分页参数。 */
export function validatePage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '分页参数不合法')
  }
}
