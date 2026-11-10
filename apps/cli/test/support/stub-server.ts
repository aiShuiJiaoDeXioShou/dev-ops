import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import type { TestContext } from 'node:test'

/** 启动本地 HTTP 桩服务；测试结束自动关闭。 */
export async function startStubServer(t: TestContext, listener: RequestListener): Promise<string> {
  const server = createServer(listener)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务未获得端口')
  return `http://127.0.0.1:${address.port}`
}

/** 成功信封。 */
export function successEnvelope(data: unknown, requestId = 'test-request') {
  return JSON.stringify({ success: true, code: 'OK', message: 'OK', requestId, data })
}

/** 失败信封。 */
export function failureEnvelope(code: string, message: string, requestId = 'test-request') {
  return JSON.stringify({ success: false, code, message, requestId })
}
