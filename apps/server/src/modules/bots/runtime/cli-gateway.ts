import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

/**
 * 为沙盒建立固定平台目标的回环代理，不允许通过请求更换上游。
 * @param origin 已校验的平台地址。
 * @returns 本机地址和释放监听端口的方法；绑定失败向调用者抛错。
 */
export async function createCliGateway(origin: string) {
  const target = new URL(origin)
  const server = createServer((request, response) => {
    if (!request.url?.startsWith('/api/v1/') || request.url.startsWith('//')) {
      response.writeHead(400).end()
      return
    }
    const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: target.host },
        timeout: 30_000,
      },
      (result) => {
        if (result.statusCode && result.statusCode >= 300 && result.statusCode < 400) {
          result.resume()
          response.writeHead(502).end()
          return
        }
        response.writeHead(result.statusCode ?? 502, result.headers)
        result.pipe(response)
      },
    )
    upstream.on('timeout', () => upstream.destroy(new Error('平台请求超时')))
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    response.on('close', () => upstream.destroy())
    request.on('aborted', () => upstream.destroy())
    request.pipe(upstream)
  })
  server.maxConnections = 16
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('平台代理未返回监听地址')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    /** 关闭运行的代理与所有连接，避免运行结束后继续调用。 */
    async close(): Promise<void> {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}
