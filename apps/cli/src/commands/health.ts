import { createApiClient, type HealthResponse } from '@dev-ops/api-client'

/**
 * 通过共享客户端请求后端存活状态，使用后端生成的接口契约校验响应。
 * @param url 已校验的服务基础地址，可以包含反向代理前缀。
 * @param timeoutMs 覆盖连接及响应体读取的超时，单位为毫秒。
 * @returns 仅包含已验证状态的对象，不透传服务端额外字段。
 * @throws 配置非法、请求失败、超时或响应不符合接口契约时抛出可展示错误。
 * @remarks 发起一次 GET 请求，不自动重试或跟随重定向。
 */
export async function checkHealth(url: URL, timeoutMs: number): Promise<HealthResponse> {
  const client = createApiClient({ baseUrl: url, timeoutMs })
  return (await client.health()).data
}
