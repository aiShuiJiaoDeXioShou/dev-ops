import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'

/** 附件策略；由集中配置提供，并通过策略接口暴露给前端。 */
export interface AttachmentPolicy {
  maxFileBytes: number
  maxFilesPerSubmit: number
  maxFilesPerRecord: number
  tempRetentionHours: number
}

const MAX_FILE_NAME_LENGTH = 255
const CONTROL_CHARACTERS = /\p{Cc}/u

/**
 * 规范化并校验附件文件名。
 * @param raw 上传请求头中的文件名（已 URI 解码）。
 * @returns 去除首尾空白并做 Unicode 规范化后的文件名。
 * @throws 文件名为空、超长、含路径分隔符或控制字符时抛出 ATTACHMENT_INVALID。
 */
export function normalizeAttachmentFileName(raw: string): string {
  const normalized = raw.normalize('NFKC').trim()
  if (!normalized) throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '文件名不能为空')
  if (Array.from(normalized).length > MAX_FILE_NAME_LENGTH) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '文件名长度不能超过 255 个字符')
  }
  if (normalized === '.' || normalized === '..' || /[\\/]/.test(normalized) || CONTROL_CHARACTERS.test(normalized)) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '文件名包含不允许的字符')
  }
  return normalized
}

/**
 * 校验单文件大小。
 * @param sizeBytes 实际字节数。
 * @param maxFileBytes 单文件上限。
 * @throws 为零、为负或超过上限时抛出业务错误。
 */
export function assertAttachmentSize(sizeBytes: number, maxFileBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '文件不能为空')
  }
  if (sizeBytes > maxFileBytes) {
    throw new ApiError(
      ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED,
      `单个附件不能超过 ${Math.floor(maxFileBytes / (1024 * 1024))} MB`,
    )
  }
}

/**
 * 校验本次提交的附件数量。
 * @param addedCount 本次新绑定数量。
 * @param currentCount 记录已绑定数量；创建场景传 0。
 * @param policy 附件策略。
 * @throws 超过单次或单记录上限时抛出 ATTACHMENT_LIMIT_EXCEEDED。
 */
export function assertSubmitAttachmentCount(
  addedCount: number,
  currentCount: number,
  policy: Pick<AttachmentPolicy, 'maxFilesPerSubmit' | 'maxFilesPerRecord'>,
): void {
  if (addedCount > policy.maxFilesPerSubmit) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED, `单次最多提交 ${policy.maxFilesPerSubmit} 个附件`)
  }
  if (currentCount + addedCount > policy.maxFilesPerRecord) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED, `单条记录最多保留 ${policy.maxFilesPerRecord} 个附件`)
  }
}

/**
 * 解析并校验 Content-Length 请求头。
 * @param header 请求头原值。
 * @param maxFileBytes 单文件上限。
 * @returns 可信的字节数。
 * @throws 缺失、非法或超过上限时抛出业务错误。
 */
export function parseAttachmentContentLength(header: string | undefined, maxFileBytes: number): number {
  if (!header) throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '缺少 Content-Length，无法上传附件')
  const size = Number(header)
  if (!Number.isSafeInteger(size)) throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, 'Content-Length 不合法')
  assertAttachmentSize(size, maxFileBytes)
  return size
}
