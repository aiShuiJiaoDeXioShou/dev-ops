import type { paths } from './generated/api.js'
import validateHealth from './generated/health.mjs'
import validateReadiness from './generated/readiness.mjs'
import validateError from './generated/error.mjs'

export type HealthResponse = paths['/api/v1/health']['get']['responses'][200]['content']['application/json']
export type ReadinessResponse = paths['/api/v1/ready']['get']['responses'][200]['content']['application/json']
type RequestErrorCode = 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE'

interface RequestErrorOptions {
  code: RequestErrorCode
  status?: number
  requestId?: string | null
  responseValid?: boolean
  serverCode?: string
}

/** 只携带可展示的说明和排障标识，不保存原始响应或凭据。 */
export class RequestError extends Error {
  readonly code: RequestErrorCode
  readonly status: number | null
  readonly requestId: string | null
  readonly responseValid: boolean | null
  readonly serverCode: string | null

  /**
   * 创建统一请求错误。
   * @param message 客户端生成的可展示说明，不使用服务端任意正文。
   * @param options 错误类别、状态、请求标识及错误响应契约的校验结果。
   * @returns 错误实例；不记录日志或保存原始响应。
   */
  constructor(message: string, options: RequestErrorOptions) {
    super(message)
    this.name = 'RequestError'
    this.code = options.code
    this.status = options.status ?? null
    this.requestId = options.requestId ?? null
    this.responseValid = options.responseValid ?? null
    this.serverCode = options.serverCode ?? null
  }
}

export interface ApiClientOptions {
  baseUrl: string | URL
  timeoutMs?: number
  credentials?: RequestCredentials
  fetch?: typeof fetch
}

/**
 * 创建不依赖浏览器全局对象的 API 客户端，不发起请求。
 * @param options 服务基础地址、超时、会话策略及可替换的 fetch 实现。
 * @returns 提供已校验健康与就绪请求的客户端；每次请求单独处理取消和超时。
 * @throws 地址包含凭据、查询参数或片段，协议不支持，或超时不在 1 至 300000 毫秒时抛出错误。
 */
export function createApiClient(options: ApiClientOptions) {
  let baseUrl: URL
  try {
    baseUrl = new URL(options.baseUrl)
  } catch {
    throw new Error('服务地址必须是完整的 HTTP 或 HTTPS URL')
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('服务地址仅支持 HTTP/HTTPS，且不能包含凭据、查询参数或片段')
  }
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('请求超时必须是 1 至 300000 之间的整数毫秒')
  }
  const fetchRequest = options.fetch

  async function get<T>(path: string, validate: (value: unknown) => value is T, signal?: AbortSignal) {
    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
    const timeout = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await (fetchRequest ?? globalThis.fetch)(url, {
        signal: requestSignal, redirect: 'error',
        credentials: options.credentials ?? 'omit',
        headers: { accept: 'application/json' },
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new RequestError(timeout.aborted ? '请求超时，请稍后重试。' : '无法连接后端，请检查服务地址和网络。', {
        code: timeout.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      })
    }
    const requestId = response.headers.get('x-request-id')
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      if (timeout.aborted) throw new RequestError('请求超时，请稍后重试。', { code: 'TIMEOUT', requestId })
      if (!response.ok) {
        throw new RequestError(`服务请求失败（HTTP ${response.status}），请稍后重试。`, {
          code: 'HTTP_ERROR', status: response.status, requestId, responseValid: false,
        })
      }
      throw new RequestError('后端未返回有效 JSON。', { code: 'INVALID_RESPONSE', requestId })
    }
    if (!response.ok) {
      const details = validateError(body)
        ? { responseValid: true, serverCode: body.code }
        : { responseValid: false }
      throw new RequestError(`服务请求失败（HTTP ${response.status}），请稍后重试。`, {
        code: 'HTTP_ERROR', status: response.status, requestId,
        ...details,
      })
    }
    if (!validate(body)) throw new RequestError('后端响应不符合接口契约。', { code: 'INVALID_RESPONSE', requestId })
    return { data: body, requestId }
  }

  return {
    /**
     * 读取进程存活状态，不检查数据库。
     * @param signal 调用方取消信号，覆盖连接和响应体读取。
     * @returns 已验证并筛选的存活状态及请求标识。
     * @throws 请求失败、超时或契约错误时抛出 RequestError；主动取消向上传递。
     */
    async health(signal?: AbortSignal) {
      const result = await get('/api/v1/health', validateHealth, signal)
      return { ...result, data: { status: result.data.status } }
    },
    /**
     * 读取数据库就绪状态。
     * @param signal 调用方取消信号，覆盖连接和响应体读取。
     * @returns 已验证并筛选的就绪状态及请求标识。
     * @throws 请求失败、超时或契约错误时抛出 RequestError；主动取消向上传递。
     */
    async ready(signal?: AbortSignal) {
      const result = await get('/api/v1/ready', validateReadiness, signal)
      return { ...result, data: { status: result.data.status, database: result.data.database } }
    },
  }
}
