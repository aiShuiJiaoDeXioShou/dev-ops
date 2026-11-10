import { createApiClient, RequestError, type ApiClientOptions } from '@dev-ops/api-client'
import type { SuccessEnvelope } from './output.ts'

/** 已解析的平台信封。 */
interface Envelope<T> {
  success: boolean
  code: string
  message: string
  requestId: string
  data?: T
}

/** 创建带 Bearer Token 的共享客户端；Web 不走该函数。 */
export function createHttpClient(baseUrl: URL, timeoutMs: number, token?: string) {
  const options: ApiClientOptions = {
    baseUrl,
    timeoutMs,
    ...(process.env.NODE_ENV === 'test' ? { validateResponses: false } : {}),
  }
  if (token !== undefined) options.token = token
  return createApiClient(options)
}

/**
 * 直接读取受保护接口，用于尚未进入生成客户端的 `/me`。
 * @param baseUrl 服务基础地址。
 * @param timeoutMs 超时。
 * @param token API Token。
 * @param path `/api/v1` 下的路径。
 * @returns 成功信封。
 * @throws 网络、超时、HTTP 或业务失败时抛出 RequestError。
 */
export async function fetchEnvelope<T>(
  baseUrl: URL,
  timeoutMs: number,
  token: string,
  path: string,
): Promise<SuccessEnvelope<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(new URL(path, baseUrl), {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: controller.signal,
    })
  } catch {
    throw new RequestError(
      controller.signal.aborted ? '请求超时，请稍后重试。' : '无法连接后端，请检查服务地址和网络。',
      { code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' },
    )
  } finally {
    clearTimeout(timer)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new RequestError('后端未返回有效 JSON。', { code: 'INVALID_RESPONSE', status: response.status })
  }
  if (!response.ok) {
    throw new RequestError(`服务请求失败（HTTP ${response.status}）。`, {
      code: 'HTTP_ERROR',
      status: response.status,
    })
  }
  const envelope = body as Envelope<T>
  if (typeof body !== 'object' || body === null || !('success' in envelope) || !envelope.success) {
    throw new RequestError(
      typeof envelope === 'object' && envelope !== null && typeof envelope.message === 'string'
        ? envelope.message
        : '后端返回失败。',
      {
        code: 'BUSINESS_ERROR',
        status: response.status,
        requestId: typeof envelope.requestId === 'string' ? envelope.requestId : undefined,
        responseValid: true,
        serverCode: typeof envelope.code === 'string' ? envelope.code : undefined,
      },
    )
  }
  return envelope as SuccessEnvelope<T>
}
