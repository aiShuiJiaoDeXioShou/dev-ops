/**
 * 请求后端存活接口并校验响应，避免把代理页面或错误数据当成健康状态。
 * @param url 已校验的 HTTP/HTTPS 健康检查完整地址。
 * @param timeoutMs 覆盖连接及响应体读取的超时，单位为毫秒，必须为正整数。
 * @returns 仅包含已验证状态的对象，不透传服务端其他字段。
 * @throws 请求超时、网络失败、HTTP 非成功状态或响应不符合接口契约时抛出中文错误。
 * @remarks 发起一次 GET 请求，不自动重试，也不跟随重定向。
 */
export async function checkHealth(url: URL, timeoutMs: number): Promise<{ status: 'ok' }> {
  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(url, { signal, redirect: 'error', headers: { accept: 'application/json' } })
  } catch {
    throw new Error(signal.aborted ? '健康检查超时' : '无法连接后端，请检查服务地址和网络')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`健康检查失败，HTTP ${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(signal.aborted ? '健康检查超时' : '后端未返回有效 JSON')
  }
  if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ok') {
    throw new Error('后端响应不符合健康检查契约')
  }
  return { status: 'ok' }
}
