import { RequestError } from '@dev-ops/api-client'
import { describeRequestError } from '@/shared/api/errors'

/**
 * 储存桶相关业务错误的可读说明。
 * 服务端返回稳定错误码；这里补上页面语境，避免落到「操作未完成」这样的泛化提示。
 */
const STORAGE_ERROR_MESSAGES: Record<string, string> = {
  STORAGE_BUCKET_NOT_FOUND: '储存桶不存在或已被删除，请刷新列表后重试。',
  STORAGE_BUCKET_NAME_CONFLICT: '储存桶名称已被占用，请换一个名称。',

  STORAGE_BUCKET_NOT_WRITABLE: '储存桶当前不可用，请先完成连接测试并确认可读写。',
  STORAGE_BUCKET_PROBE_FAILED: '连接测试未通过，请检查接入地址、桶名与凭据后重试。',
  STORAGE_BUCKET_BUILTIN_PROTECTED: '内置本地储存桶受保护，只允许修改名称。',
}

/**
 * 把储存桶操作错误转换为可展示说明与请求标识。
 * @param error 任意捕获值，通常为 RequestError。
 * @returns 页面可展示的安全说明与可选请求标识；不包含密钥或原始响应。
 */
export function describeStorageError(error: unknown): { description: string; requestId: string | null } {
  if (error instanceof RequestError && error.serverCode) {
    // 引用保护要展示具体数量；服务端把数量放在业务失败 data 中，结构需先校验再使用。
    if (error.serverCode === 'STORAGE_BUCKET_IN_USE') {
      const count = readAttachmentCount(error.data)
      if (count !== null) {
        return {
          description: `该储存桶仍被 ${count} 个附件引用，不能停用或删除；请先处理引用它的附件后再试。`,
          requestId: error.requestId,
        }
      }
    }
    const mapped = STORAGE_ERROR_MESSAGES[error.serverCode]
    if (mapped) return { description: mapped, requestId: error.requestId }
  }
  return describeRequestError(error)
}

/**
 * 从业务失败 data 中读取附件引用数量。
 * @param data 业务失败信封中的 data。
 * @returns 非负整数数量；结构不合法时返回 null。
 */
function readAttachmentCount(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const value = (data as { attachmentCount?: unknown }).attachmentCount
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
