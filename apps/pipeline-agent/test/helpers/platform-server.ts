import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 测试捕获到的请求；body 为原始字节，支持产物二进制上传断言。 */
export interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

/** mock 平台返回；默认 HTTP 200 + JSON。 */
export interface MockResponse {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type MockHandler = (request: RecordedRequest) => MockResponse | Promise<MockResponse>

/** 本地 mock 平台；测试不依赖外网，行为与真实信封格式一致。 */
export interface MockPlatform {
  url: string
  requests: RecordedRequest[]
  close(): Promise<void>
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk)
    else chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * 启动本地 mock 平台。
 * @param handler 按请求返回响应；抛错时返回 HTTP 500。
 * @returns 平台地址、已记录请求列表与关闭方法。
 */
export async function startMockPlatform(handler: MockHandler): Promise<MockPlatform> {
  const requests: RecordedRequest[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await readBody(request)
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        headers: request.headers,
        body,
      }
      requests.push(recorded)
      try {
        const result = await handler(recorded)
        response.writeHead(result.status ?? 200, { 'content-type': 'application/json', ...result.headers })
        response.end(result.body === undefined ? '' : JSON.stringify(result.body))
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ success: false, code: 'MOCK_FAILURE', message: String(error) }))
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock 平台端口获取失败')
  const { port } = address
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

/** 构造成功信封。 */
export function okEnvelope(data: unknown): MockResponse {
  return { body: { success: true, code: 'OK', message: 'ok', requestId: 'test-request', data } }
}

/** 构造业务失败信封（HTTP 200）。 */
export function errorEnvelope(code: string, message: string, data?: unknown): MockResponse {
  return { body: { success: false, code, message, requestId: 'test-request', ...(data === undefined ? {} : { data }) } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析记录的 JSON 请求体；测试断言专用。 */
export function jsonBody(request: RecordedRequest): Record<string, unknown> {
  const parsed: unknown = JSON.parse(request.body.toString('utf8'))
  if (!isPlainObject(parsed)) throw new Error('请求体不是 JSON 对象')
  return parsed
}

/** 按路径筛选记录；便于断言请求次数与顺序。 */
export function requestsTo(requests: readonly RecordedRequest[], path: string): RecordedRequest[] {
  return requests.filter((request) => request.path === path)
}

/**
 * 取指定路径的唯一请求，供测试断言使用。
 * @param requests 已记录请求列表。
 * @param path 请求路径。
 * @returns 该路径的第一条请求。
 * @throws 没有匹配请求时抛出，避免断言静默跳过。
 */
export function requiredRequest(requests: readonly RecordedRequest[], path: string): RecordedRequest {
  const matched = requestsTo(requests, path)
  if (matched.length === 0) throw new Error(`未收到请求：${path}`)
  const [first] = matched
  if (!first) throw new Error(`未收到请求：${path}`)
  return first
}

/** 读取请求头中的单值字符串。 */
export function headerOf(request: RecordedRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}
