import { RequestError } from '@dev-ops/api-client'
import type { UploadedAttachment } from '../model/types'

/** 附件上传独立超时；覆盖 50 MB 文件，不继承 api-client 的 15 秒业务超时。 */
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120_000

/** 用户主动取消上传时抛出的错误；调用方据此静默移除该行，不展示失败态。 */
export class UploadAbortedError extends Error {
  constructor() {
    super('上传已取消')
    this.name = 'UploadAbortedError'
  }
}

/**
 * 判断上传错误是否由用户取消导致。
 * @param error 上传 promise 的拒绝原因。
 * @returns 是否为主动取消。
 */
export function isUploadAborted(error: unknown): error is UploadAbortedError {
  return error instanceof UploadAbortedError
}

/** 单个文件的上传句柄；promise 只结算一次，进度监听可在上传过程中多次触发。 */
export interface AttachmentUploadHandle {
  /** 上传结果；成功返回服务端临时附件摘要。 */
  promise: Promise<UploadedAttachment>
  /** 取消上传；已结算时为空操作。 */
  abort: () => void
  /** 注册进度监听，回调参数为 0–100 的整数百分比。 */
  onProgress: (listener: (progress: number) => void) => void
}

interface UploadAttachmentInput {
  /** 目标项目标识；附件先落入该项目临时区，提交业务记录时再绑定。 */
  projectId: string
  /** 用户选择的本地文件。 */
  file: File
  /** 超时毫秒数；测试可注入更短的值。 */
  timeoutMs?: number
}

/**
 * 判断未知响应是否带业务失败信封。
 * @param value JSON 解析后的响应体。
 * @returns 是否包含 success=false 与稳定业务码。
 */
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
 * 判断未知响应是否为上传成功信封。
 * @param value JSON 解析后的响应体。
 * @returns 是否包含 attachment 摘要。
 */
function isUploadSuccessEnvelope(value: unknown): value is { success: true; data: { attachment: UploadedAttachment } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === true &&
    'data' in value &&
    typeof value.data === 'object' &&
    value.data !== null &&
    'attachment' in value.data &&
    typeof value.data.attachment === 'object' &&
    value.data.attachment !== null
  )
}

/**
 * 用 XHR 上传单个附件。必须使用 XHR 而不是 api-client：上传需要进度事件与更长的独立超时。
 * @param input 项目标识、文件与可选超时。
 * @returns 上传句柄；promise 在成功、失败或取消时结算，进度监听按需注册。
 * @sideEffect 发起带 Cookie 的同源 POST 请求，发送后由服务端写入临时附件。
 */
export function uploadAttachment(input: UploadAttachmentInput): AttachmentUploadHandle {
  const { projectId, file, timeoutMs = ATTACHMENT_UPLOAD_TIMEOUT_MS } = input
  const xhr = new XMLHttpRequest()
  const progressListeners: Array<(progress: number) => void> = []
  let settled = false
  const notifyProgress = (progress: number) => {
    for (const listener of progressListeners) listener(progress)
  }
  const promise = new Promise<UploadedAttachment>((resolve, reject) => {
    // 相对路径保证同源；Cookie 由 withCredentials 携带，不使用 api-client 的 JSON 管线。
    xhr.open('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/attachments`)
    xhr.withCredentials = true
    xhr.timeout = timeoutMs
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      notifyProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      settled = true
      const requestId = xhr.getResponseHeader('x-request-id')
      let payload: unknown
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        reject(
          new RequestError('上传响应格式不正确，请重试。', {
            code: 'INVALID_RESPONSE',
            status: xhr.status,
            requestId,
          }),
        )
        return
      }
      if (xhr.status >= 200 && xhr.status < 300 && isUploadSuccessEnvelope(payload)) {
        resolve(payload.data.attachment)
        return
      }
      if (isFailureEnvelope(payload)) {
        reject(
          new RequestError('上传未完成，请重试。', {
            code: 'BUSINESS_ERROR',
            status: xhr.status,
            requestId: payload.requestId || requestId,
            serverCode: payload.code,
            responseValid: true,
          }),
        )
        return
      }
      reject(
        new RequestError('上传失败，请稍后重试。', {
          code: 'HTTP_ERROR',
          status: xhr.status,
          requestId,
        }),
      )
    }
    xhr.onerror = () => {
      settled = true
      reject(new RequestError('上传失败，请检查网络后重试。', { code: 'NETWORK_ERROR' }))
    }
    xhr.ontimeout = () => {
      settled = true
      reject(new RequestError('上传超时，请检查网络后重试。', { code: 'TIMEOUT' }))
    }
    xhr.onabort = () => {
      settled = true
      reject(new UploadAbortedError())
    }
    xhr.send(file)
  })
  return {
    promise,
    abort: () => {
      if (!settled) xhr.abort()
    },
    onProgress: (listener) => {
      progressListeners.push(listener)
    },
  }
}
