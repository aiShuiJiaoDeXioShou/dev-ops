import { Type } from 'typebox'
import { z } from 'zod'
import type { BotConfig } from '../config.ts'
import { BotError } from '../errors.ts'
import { defineTool, MAX_FILE_BYTES } from './common.ts'

const httpUrl = z
  .url()
  .max(8192)
  .refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  })
const searchResponse = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: httpUrl,
      snippet: z.string(),
      summary: z.string(),
      date: z.string().nullable(),
    }),
  ),
})
const fetchResponse = z.object({ title: z.string(), content: z.string() })

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new BotError('WEB_RESPONSE_INVALID', 'DeepSeek 联网接口返回了空响应')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_FILE_BYTES)
        throw new BotError('WEB_RESPONSE_TOO_LARGE', '网页响应超过 1 MiB，请缩小查询或选择较小页面')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BotError('WEB_RESPONSE_INVALID', 'DeepSeek 联网接口未返回合法 JSON')
  }
}

async function request(
  config: BotConfig,
  fetcher: typeof fetch,
  operation: 'search' | 'fetch',
  body: object,
  signal: AbortSignal,
): Promise<unknown> {
  if (!config.apiKey) throw new BotError('API_KEY_MISSING', '联网工具需要配置 DEEPSEEK_API_KEY')
  const response = await fetcher(`${config.webBaseUrl}/${operation}`, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await response.body?.cancel()
    const guidance =
      new Map([
        [401, '密钥无效或已失效'],
        [402, '账户余额不足'],
        [403, '目标被访问策略拒绝'],
        [404, '接口或可提取的页面内容不存在'],
        [429, '请求过于频繁，请稍后重试'],
      ]).get(response.status) ?? '请检查联网服务和目标页面后重试'
    throw new BotError('WEB_REQUEST_FAILED', `DeepSeek 联网请求失败（HTTP ${response.status}）：${guidance}`)
  }
  return readJson(response, signal)
}

/**
 * 将 DeepSeek Search / Fetch API 适配为 pi 工具，复用模型密钥。
 * @param config 已校验的接口地址、密钥与超时；地址只能来自本地配置，模型不能更改。
 * @param fetcher 可替换的 HTTP 实现，供离线测试使用。
 * @returns 搜索和 Markdown 网页读取工具；不引入 DSH 的 Cordis 运行环境，不自动重试计费请求。
 */
export function webTools(config: BotConfig, fetcher: typeof fetch = fetch) {
  return [
    defineTool(config, {
      name: 'web_search',
      description:
        '通过 DeepSeek Search API 搜索互联网，返回标题、URL、摘要和可用的发布日期。支持 site: 等查询语法，查询最多 128 字符。',
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 128 }),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      }),
      async run(input, signal) {
        const args = z
          .object({ query: z.string().trim().min(1).max(128), count: z.number().int().min(1).max(10).default(5) })
          .parse(input)
        const parsed = searchResponse.safeParse(
          await request(config, fetcher, 'search', { ...args, need_content: false }, signal),
        )
        if (!parsed.success) throw new BotError('WEB_RESPONSE_INVALID', 'DeepSeek 搜索响应格式不合法')
        return { text: JSON.stringify({ results: parsed.data.results.slice(0, args.count) }) }
      },
    }),
    defineTool(config, {
      name: 'web_fetch',
      description:
        '由 DeepSeek 服务端读取公网 HTTP/HTTPS 网页，返回 Markdown 正文和标题；不能访问本机或内网。引用资料时保留来源 URL。',
      parameters: Type.Object({ url: Type.String({ maxLength: 8192 }) }),
      async run(input, signal) {
        const args = z.object({ url: httpUrl }).parse(input)
        const parsed = fetchResponse.safeParse(await request(config, fetcher, 'fetch', args, signal))
        if (!parsed.success) throw new BotError('WEB_RESPONSE_INVALID', 'DeepSeek 网页响应格式不合法')
        return { text: `URL：${args.url}\n标题：${parsed.data.title}\n\n${parsed.data.content}` }
      },
    }),
  ]
}
