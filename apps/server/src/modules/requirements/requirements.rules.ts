import { ApiError } from '../../platform/http/errors.js'
import { ERROR_CODES } from '../../platform/http/error-codes.js'

export type RequirementStatus = 'pending' | 'in_development' | 'submitted' | 'in_testing' | 'passed' | 'cancelled'
export const REQUIREMENT_STATUSES: ReadonlySet<RequirementStatus> = new Set([
  'pending',
  'in_development',
  'submitted',
  'in_testing',
  'passed',
  'cancelled',
])
export const EDITABLE_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_development'])

/** 去除标题首尾空白并校验长度。 */
export function normalizeTitle(title: string): string {
  const value = title.trim()
  if (value.length === 0 || value.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '需求标题长度必须在 1-200 个字符之间')
  }
  return value
}

/**
 * 按内容方式校验正文或外部链接，并清空不适用的字段。
 * @param input 内容方式与候选字段。
 * @returns 归一化后的内容字段。
 * @throws 内容方式、正文或链接不合法时抛出 VALIDATION_ERROR。
 */
export function validateContent(input: {
  contentMode?: string
  contentMarkdown?: string | null
  externalUrl?: string | null
  externalSummary?: string | null
}): {
  contentMode: 'markdown' | 'external_link'
  contentMarkdown: string | null
  externalUrl: string | null
  externalSummary: string | null
} {
  const mode = input.contentMode
  if (mode !== 'markdown' && mode !== 'external_link') {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '需求内容方式不合法')
  }
  const markdown = input.contentMarkdown?.trim() ?? ''
  const url = input.externalUrl?.trim() ?? ''
  if (mode === 'markdown') {
    if (markdown.length === 0 || markdown.length > 100_000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '内置正文长度必须在 1-100000 个字符之间')
    }
    return { contentMode: 'markdown', contentMarkdown: markdown, externalUrl: null, externalSummary: null }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '外部文档链接不合法')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || url.length > 2048) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '外部文档链接仅支持 HTTP/HTTPS')
  }
  const summary = input.externalSummary?.trim()
  if (summary !== undefined && summary.length > 2000) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '外部文档摘要不能超过 2000 个字符')
  }
  return {
    contentMode: 'external_link',
    contentMarkdown: null,
    externalUrl: url,
    externalSummary: summary && summary.length > 0 ? summary : null,
  }
}

/** 校验需求业务状态。 */
export function validateStatus(status: string): RequirementStatus {
  if (!REQUIREMENT_STATUSES.has(status as RequirementStatus)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '需求状态不合法')
  }
  return status as RequirementStatus
}

/** 校验分页参数。 */
export function validatePage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '分页参数不合法')
  }
}
