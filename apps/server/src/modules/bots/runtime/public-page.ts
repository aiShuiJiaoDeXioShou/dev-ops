import { lookup } from 'node:dns/promises'
import { get as getHttp, type IncomingMessage } from 'node:http'
import { get as getHttps } from 'node:https'
import { BlockList, isIP } from 'node:net'

const BLOCKED = new BlockList()
const IPV4_RESERVED = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const
for (const [address, mask] of IPV4_RESERVED) BLOCKED.addSubnet(address, mask)
BLOCKED.addSubnet('2001::', 23, 'ipv6')
BLOCKED.addSubnet('2001:db8::', 32, 'ipv6')
BLOCKED.addSubnet('2002::', 16, 'ipv6')

const BYTE_LIMIT = 1024 * 1024
const TEXT_LIMIT = 32000
const REDIRECT_LIMIT = 3

function publicAddress(address: string, family: number): boolean {
  if (family === 4) return !BLOCKED.check(address, 'ipv4')
  if (family === 6) return /^[23]/u.test(address) && !BLOCKED.check(address, 'ipv6')
  return false
}

/**
 * 在请求前解析并校验公网地址，供出站连接固定使用已校验的 IP。
 * @param url 要访问的外部服务 URL。
 * @returns 公网 IP 及地址族；任何 DNS 结果落入禁用网段时拒绝。
 */
export async function resolveBotPublicAddress(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/gu, '')
  const family = isIP(host)
  const resolved = family ? [{ address: host, family }] : await lookup(host, { all: true })
  const first = resolved[0]
  if (!first || !resolved.every((item) => publicAddress(item.address, item.family))) {
    throw new Error('网页地址不属于公网')
  }
  return first
}

async function openPage(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
  ) {
    throw new Error('只允许直接访问公开 HTTP 或 HTTPS 网页')
  }
  const target = await resolveBotPublicAddress(url)
  signal.throwIfAborted()
  const get = url.protocol === 'https:' ? getHttps : getHttp
  return new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        agent: false,
        family: target.family,
        lookup: (_name, _options, callback) => callback(null, target.address, target.family),
        signal,
        headers: { accept: 'text/html,text/plain,application/xhtml+xml', 'accept-encoding': 'identity' },
      },
      resolve,
    )
    request.once('error', reject)
  })
}

function cleanText(value: string) {
  return value
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gu, (entity) => {
      switch (entity) {
        case '&amp;':
          return '&'
        case '&lt;':
          return '<'
        case '&gt;':
          return '>'
        case '&quot;':
          return '"'
        case '&#39;':
          return "'"
        default:
          return ' '
      }
    })
    .replace(/\s+/gu, ' ')
    .trim()
}

async function responseText(response: IncomingMessage) {
  const contentType = response.headers['content-type'] ?? ''
  const html = /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(contentType)
  if (!html && !/^text\/plain(?:;|$)/iu.test(contentType)) {
    response.destroy()
    throw new Error('网页未返回可读取的文本')
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    length += bytes.length
    if (length > BYTE_LIMIT) throw new Error('网页超过读取上限')
    chunks.push(bytes)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!html) return { title: '', content: text.trim().slice(0, TEXT_LIMIT) }
  const title = cleanText(/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(text)?.[1] ?? '')
  const content = cleanText(
    text
      .replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
      .replace(/<!--[\s\S]*?-->|<[^>]+>/gu, ' '),
  )
  return { title: title.slice(0, 160), content: content.slice(0, TEXT_LIMIT) }
}

/**
 * 读取并提取公网网页文本，每次跳转都重新解析与固定连接地址。
 * @param rawUrl 用户明确指定的公开地址。
 * @param signal 运行超时或停止信号。
 * @returns 文本与标题；私网地址、非文本内容或超限响应抛错。
 */
export async function fetchBotPublicPage(rawUrl: string, signal: AbortSignal) {
  let url = new URL(rawUrl)
  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects++) {
    signal.throwIfAborted()
    const response = await openPage(url, signal)
    const code = response.statusCode ?? 0
    if (code >= 300 && code < 400 && response.headers.location) {
      response.destroy()
      url = new URL(response.headers.location, url)
      continue
    }
    if (code !== 200) {
      response.destroy()
      throw new Error('公网网页读取失败')
    }
    return responseText(response)
  }
  throw new Error('网页重定向次数过多')
}
