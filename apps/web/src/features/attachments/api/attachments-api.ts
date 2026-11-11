import { RequestError } from '@dev-ops/api-client'
import type { AttachmentPolicy } from '../model/types'

/** 判断未知 JSON 是否为失败信封。 */
function isFailureEnvelope(value: unknown): value is { success: false; code: string; requestId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'code' in value &&
    typeof value.code === 'string' &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  )
}

/**
 * 判断未知 JSON 是否为成功信封并取出 data。
 * @param value 响应体。
 * @returns 是否包含 data 字段。
 */
function hasData(value: unknown): value is { success: true; data: unknown } {
  return typeof value === 'object' && value !== null && 'success' in value && value.success === true && 'data' in value
}

/**
 * 解析统一响应信封并取出 data；失败信封转换为带业务码的 RequestError。
 * @param response fetch 响应；成功与业务失败都使用 HTTP 200。
 * @returns 信封中的 data，交由调用方按契约校验。
 * @throws RequestError 响应格式不合法或业务失败时抛出。
 */
async function readEnvelopeData(response: Response): Promise<unknown> {
  const headerRequestId = response.headers.get('x-request-id')
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new RequestError('服务响应格式不正确，请稍后重试。', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      requestId: headerRequestId,
    })
  }
  if (isFailureEnvelope(payload)) {
    throw new RequestError('请求未完成，请稍后重试。', {
      code: 'BUSINESS_ERROR',
      status: response.status,
      requestId: payload.requestId || headerRequestId,
      serverCode: payload.code,
      responseValid: true,
    })
  }
  if (!hasData(payload)) {
    throw new RequestError('服务响应格式不正确，请稍后重试。', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      requestId: headerRequestId,
    })
  }
  return payload.data
}

/**
 * 校验策略响应字段是否完整合法。
 * @param value 信封中的 data。
 * @returns 是否为附件策略。
 */
function isAttachmentPolicy(value: unknown): value is AttachmentPolicy {
  return (
    typeof value === 'object' &&
    value !== null &&
    'maxFileBytes' in value &&
    typeof value.maxFileBytes === 'number' &&
    'maxFilesPerSubmit' in value &&
    typeof value.maxFilesPerSubmit === 'number' &&
    'maxFilesPerRecord' in value &&
    typeof value.maxFilesPerRecord === 'number' &&
    'tempRetentionHours' in value &&
    typeof value.tempRetentionHours === 'number'
  )
}

/**
 * 发起同源 JSON 请求并处理网络异常。
 * @param path 以 `/api/v1` 开头的接口路径。
 * @param init fetch 选项；调用方负责指定方法与请求体。
 * @returns 原始响应，供统一信封解析。
 * @throws RequestError 网络不可达时抛出；请求被取消时原样抛出取消原因。
 */
async function requestJson(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' }, ...init })
  } catch (cause) {
    if (init.signal?.aborted) throw cause
    throw new RequestError('请求失败，请检查网络后重试。', { code: 'NETWORK_ERROR' })
  }
}

/**
 * 读取附件上传策略；上限值由服务端集中配置，前端据此做前置校验。
 * @param signal 查询取消信号。
 * @returns 单文件、单次、单记录上限与临时附件保留小时数。
 * @throws RequestError 请求失败或响应不符合信封契约时抛出。
 */
export async function fetchAttachmentPolicy(signal?: AbortSignal): Promise<AttachmentPolicy> {
  const response = await requestJson('/api/v1/attachments/policy', { method: 'GET', ...(signal ? { signal } : {}) })
  const data = await readEnvelopeData(response)
  if (!isAttachmentPolicy(data)) {
    throw new RequestError('附件上传限制响应格式不正确，请稍后重试。', { code: 'INVALID_RESPONSE' })
  }
  return data
}

/**
 * 删除附件；详情列表已二次确认，本函数只负责请求与信封解析。
 * @param attachmentId 附件标识。
 * @returns 删除完成时不返回数据。
 * @throws RequestError 无权限、附件不存在或存储不可用时抛出。
 */
export async function removeAttachment(attachmentId: string): Promise<void> {
  const response = await requestJson(`/api/v1/attachments/${encodeURIComponent(attachmentId)}/remove`, {
    method: 'POST',
  })
  await readEnvelopeData(response)
}
