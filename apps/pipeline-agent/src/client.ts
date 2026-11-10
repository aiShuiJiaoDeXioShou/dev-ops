import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

import { AgentApiError, AgentTransportError, describeError } from './errors.ts'
import type { AgentLogger } from './logger.ts'

/** 重试策略；网络与传输失败按指数退避加抖动，业务错误不重试。 */
export interface RetryPolicy {
  /** 总尝试次数（含首次）；协议要求单请求最多 3 次。 */
  maxAttempts: number
  /** 首次退避基数，单位毫秒。 */
  baseDelayMs: number
  /** 单次退避上限，单位毫秒。 */
  maxDelayMs: number
  /** 抖动比例，实际延迟在 ±jitterRatio 内随机浮动。 */
  jitterRatio: number
}

/** 默认重试策略：最多 3 次尝试，250ms 起步、2s 封顶并带 30% 抖动。 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.3,
}

export interface PlatformHttpOptions {
  /** 平台地址（含协议与端口，不含 /api/v1 前缀）。 */
  baseUrl: string
  /** 单次请求超时，单位毫秒。 */
  timeoutMs: number
  retry?: Partial<RetryPolicy>
  logger?: AgentLogger
  /** 等待函数，测试可替换以加速重试。 */
  sleep?: (delayMs: number) => Promise<void>
  /** 抖动随机源，返回 0–1；测试可固定。 */
  random?: () => number
}

export interface PlatformRequest {
  method: 'GET' | 'POST'
  path: string
  /** JSON 请求体；GET 请求必须省略。 */
  body?: unknown
  headers?: Readonly<Record<string, string>>
  timeoutMs?: number
}

/** 产物流式上传请求；请求体在每次尝试时重新创建。 */
export interface BinaryUploadRequest {
  path: string
  headers: Readonly<Record<string, string>>
  createBody: () => NodeJS.ReadableStream
  timeoutMs: number
}

/** 平台 HTTP 客户端；返回值是统一信封中的 data，类型由调用方校验收窄。 */
export interface PlatformHttp {
  request(input: PlatformRequest): Promise<unknown>
  uploadBinary(input: BinaryUploadRequest): Promise<unknown>
}

interface Envelope {
  success: boolean
  code: string
  message: string
  requestId?: string
  data: unknown
}

/** 单个控制请求响应体上限；平台信封很小，超过说明响应异常。 */
const MAX_JSON_RESPONSE_BYTES = 1_048_576

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseEnvelope(text: string): Envelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AgentTransportError('平台响应不是合法 JSON')
  }
  if (!isRecord(parsed)) throw new AgentTransportError('平台响应不是 JSON 对象')
  const success = parsed.success
  if (typeof success !== 'boolean') throw new AgentTransportError('平台响应缺少 success 字段')
  const code = parsed.code
  if (typeof code !== 'string' || code.length === 0) throw new AgentTransportError('平台响应缺少 code 字段')
  const message = typeof parsed.message === 'string' ? parsed.message : ''
  const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : undefined
  return { success, code, message, data: parsed.data ?? null, ...(requestId ? { requestId } : {}) }
}

function assertEnvelopeSuccess(envelope: Envelope): unknown {
  if (!envelope.success) {
    throw new AgentApiError(envelope.code, envelope.message, envelope.requestId, envelope.data)
  }
  return envelope.data
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * 创建平台 HTTP 客户端。
 * @param options 平台地址、单次超时、重试策略与可选日志器。
 * @returns 控制请求与产物流式上传能力；非业务失败按重试策略退避，业务失败直接抛 AgentApiError。
 * @remarks 所有请求都设置超时；日志只记录路径、尝试次数与脱敏后的原因，不记录请求体与响应体。
 */
export function createPlatformHttp(options: PlatformHttpOptions): PlatformHttp {
  const retry: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry }
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  function retryDelay(attempt: number): number {
    const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1))
    const factor = 1 + retry.jitterRatio * (2 * random() - 1)
    return Math.max(0, Math.round(exponential * factor))
  }

  async function withRetry<T>(path: string, attemptRequest: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      try {
        return await attemptRequest()
      } catch (error) {
        if (error instanceof AgentApiError) throw error
        lastError = error
        if (attempt >= retry.maxAttempts) break
        const delay = retryDelay(attempt)
        options.logger?.warn(
          `请求 ${path} 失败，${delay}ms 后重试（第 ${attempt}/${retry.maxAttempts} 次）：${describeError(error)}`,
        )
        await sleep(delay)
      }
    }
    throw new AgentTransportError(`请求 ${path} 在 ${retry.maxAttempts} 次尝试后失败：${describeError(lastError)}`, {
      cause: lastError,
    })
  }

  async function sendJson(input: PlatformRequest): Promise<unknown> {
    const url = new URL(input.path, options.baseUrl)
    const timeoutMs = input.timeoutMs ?? options.timeoutMs
    const headers: Record<string, string> = { accept: 'application/json', ...input.headers }
    const init: RequestInit = { method: input.method, headers, signal: AbortSignal.timeout(timeoutMs) }
    if (input.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(input.body)
    }
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      throw new AgentTransportError(`网络请求失败：${describeError(error)}`, { cause: error })
    }
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw new AgentTransportError(`读取平台响应失败：${describeError(error)}`, { cause: error })
    }
    if (response.status !== 200) {
      throw new AgentTransportError(`平台返回 HTTP ${response.status}`)
    }
    if (text.length > MAX_JSON_RESPONSE_BYTES) throw new AgentTransportError('平台响应超过大小上限')
    return assertEnvelopeSuccess(parseEnvelope(text))
  }

  function sendBinary(input: BinaryUploadRequest): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const url = new URL(input.path, options.baseUrl)
      const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
      const request = requestFn(
        url,
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/octet-stream', ...input.headers },
          timeout: input.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = []
          let received = 0
          response.on('data', (chunk: Buffer) => {
            received += chunk.byteLength
            if (received > MAX_JSON_RESPONSE_BYTES) {
              response.destroy(new AgentTransportError('平台响应超过大小上限'))
              return
            }
            chunks.push(chunk)
          })
          response.on('error', (error: Error) => {
            reject(new AgentTransportError(`读取平台响应失败：${describeError(error)}`, { cause: error }))
          })
          response.on('end', () => {
            const status = response.statusCode ?? 0
            if (status !== 200) {
              reject(new AgentTransportError(`平台返回 HTTP ${status}`))
              return
            }
            try {
              resolve(assertEnvelopeSuccess(parseEnvelope(Buffer.concat(chunks).toString('utf8'))))
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      request.on('timeout', () => {
        request.destroy(new AgentTransportError('产物流式上传超时'))
      })
      request.on('error', (error: Error) => {
        reject(
          error instanceof AgentTransportError
            ? error
            : new AgentTransportError(`产物流式上传失败：${describeError(error)}`, { cause: error }),
        )
      })
      const body = input.createBody()
      body.on('error', (error: Error) => {
        request.destroy(new AgentTransportError(`读取上传内容失败：${describeError(error)}`, { cause: error }))
      })
      body.pipe(request)
    })
  }

  return {
    request(input: PlatformRequest): Promise<unknown> {
      return withRetry(input.path, () => sendJson(input))
    },
    uploadBinary(input: BinaryUploadRequest): Promise<unknown> {
      return withRetry(input.path, () => sendBinary(input))
    },
  }
}
