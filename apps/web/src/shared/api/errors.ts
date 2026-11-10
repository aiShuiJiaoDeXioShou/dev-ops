import { RequestError } from '@dev-ops/api-client'

const BUSINESS_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: '登录状态已失效，请重新登录。',
  FORBIDDEN: '当前角色无权执行该操作。',
  NOT_FOUND: '请求的记录不存在或已不可用。',
  VALIDATION_ERROR: '提交内容不合法，请检查后重试。',
  PRECONDITION_FAILED: '当前状态不允许该操作，请刷新后重试。',
  VERSION_CONFLICT: '记录已被其他人更新，请刷新后重试。',
  DUPLICATE_RELATION: '该关联已存在。',
  LAST_ADMIN_PROTECTED: '至少保留一位正常管理员。',
  IDEMPOTENCY_CONFLICT: '请求已处理，请刷新后查看结果。',
  INVALID_TRANSITION: '当前状态不允许该操作。',
}

/** 将请求错误转成安全、可展示的说明与请求标识。 */
export function describeRequestError(error: unknown): { description: string; requestId: string | null } {
  if (error instanceof RequestError) {
    const mapped = error.serverCode ? BUSINESS_MESSAGES[error.serverCode] : undefined
    return { description: mapped ?? error.message, requestId: error.requestId }
  }
  return { description: '请求失败，请检查网络后重试。', requestId: null }
}
