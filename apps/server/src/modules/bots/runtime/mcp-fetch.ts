import { request } from 'node:https'
import { isIP } from 'node:net'
import { resolveBotPublicAddress } from './public-page.ts'

const RESPONSE_LIMIT = 2 * 1024 * 1024

/**
 * 远程 MCP 仅允许 HTTPS，凭据通过独立请求头提供。
 * @param value 管理员配置的服务地址。
 * @returns 规范化的目标；不符合远程访问约束时拒绝。
 */
export function parseBotMcpUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isIP(url.hostname) !== 0 ||
    !url.hostname.includes('.') ||
    /(?:^|\.)(?:local|internal|localhost)$/iu.test(url.hostname)
  ) {
    throw new Error('MCP 地址必须是公网 HTTPS 服务')
  }
  return url
}

/**
 * 通过已校验的公网 IP 访问 MCP，保留原主机名进行 TLS 校验。
 * @param input 当前 MCP 的固定服务地址。
 * @param init 由协议适配器传入的 HTTP 请求。
 * @returns 有大小边界的协议响应，重定向和内网地址被拒绝。
 */
export async function fetchBotMcp(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = parseBotMcpUrl(String(input))
  const signal = init?.signal ?? AbortSignal.timeout(15_000)
  signal.throwIfAborted()
  const target = await resolveBotPublicAddress(url)
  signal.throwIfAborted()
  if (init?.body !== null && init?.body !== undefined && typeof init.body !== 'string')
    throw new Error('MCP 请求格式不合法')
  const body = init?.body
  const headers = new Headers(init?.headers)
  headers.set('accept-encoding', 'identity')
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(headers),
        agent: false,
        family: target.family,
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
        signal,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502
        if (status >= 300 && status < 400) {
          incoming.destroy()
          reject(new Error('MCP 服务禁止重定向'))
          return
        }
        const headers = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string') headers.set(key, value)
        }
        if (status === 204 || status === 205 || status < 200) {
          incoming.resume()
          resolve(new Response(null, { status: Math.max(status, 200), headers }))
          return
        }
        async function* bytes() {
          let size = 0
          for await (const chunk of incoming) {
            if (!Buffer.isBuffer(chunk)) throw new Error('MCP 响应格式不合法')
            size += chunk.byteLength
            if (size > RESPONSE_LIMIT) throw new Error('MCP 响应超过上限')
            yield new Uint8Array(chunk)
          }
        }
        const data = bytes()
        const output = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = await data.next()
            if (next.done) controller.close()
            else controller.enqueue(next.value)
          },
          async cancel() {
            incoming.destroy()
            await data.return(undefined)
          },
        })
        resolve(new Response(output, { status, headers }))
      },
    )
    outgoing.once('error', reject)
    outgoing.end(body ?? undefined)
  })
}
