import { RequestError } from '@dev-ops/api-client'
import { describeRequestError } from '@/shared/api/errors'

/** 附件相关业务错误码的展示文案；集中在此，避免各组件重复拼措辞。 */
const ATTACHMENT_MESSAGES: Record<string, string> = {
  ATTACHMENT_NOT_FOUND: '附件不存在或已被删除。',
  ATTACHMENT_INVALID: '附件内容或文件名不合法，请重新选择。',
  ATTACHMENT_LIMIT_EXCEEDED: '附件超过大小或数量上限，请调整后重试。',
  ATTACHMENT_STATE_CONFLICT: '附件状态已变化，请刷新后重试。',
  ATTACHMENT_STORAGE_UNAVAILABLE: '附件存储暂时不可用，请联系平台管理员。',
}

/**
 * 把附件相关请求错误转换为可读说明；未知业务码回落到统一错误映射。
 * @param error 上传、下载或删除附件时捕获的错误。
 * @returns 面向用户的精简说明；不暴露服务端堆栈或存储细节。
 */
export function describeAttachmentError(error: unknown): string {
  if (error instanceof RequestError && error.serverCode) {
    const mapped = ATTACHMENT_MESSAGES[error.serverCode]
    if (mapped) return mapped
  }
  return describeRequestError(error).description
}
