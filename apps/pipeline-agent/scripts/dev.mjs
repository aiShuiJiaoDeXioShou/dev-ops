import { setTimeout as delay } from 'node:timers/promises'

import { loadAgentConfig } from '../src/config.ts'

const WAIT_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 500

async function isPlatformReady(url, signal) {
  try {
    const response = await fetch(url, { signal, redirect: 'manual' })
    if (!response.ok) {
      await response.body?.cancel()
      return false
    }
    const result = await response.json()
    // 平台的数据库未就绪时也会返回 HTTP 200，需要检查响应信封。
    return result?.success === true
  } catch (error) {
    if (signal.aborted || error instanceof TypeError || error instanceof SyntaxError) return false
    throw error
  }
}

async function waitForPlatform(platformUrl) {
  const url = new URL('/api/v1/ready', platformUrl)
  const signal = AbortSignal.timeout(WAIT_TIMEOUT_MS)
  console.log(`[pipeline-agent] 等待平台 API 就绪（${url.origin}）`)
  while (!signal.aborted) {
    if (await isPlatformReady(url, AbortSignal.any([signal, AbortSignal.timeout(1_000)]))) return
    if (!signal.aborted) await delay(POLL_INTERVAL_MS)
  }
  throw new Error('等待平台 API 就绪超时，请检查 HTTP 服务和 PostgreSQL')
}

try {
  const { platformUrl } = loadAgentConfig()
  await waitForPlatform(platformUrl)
  await import('../src/index.ts')
} catch (error) {
  console.error(`[pipeline-agent] 开发启动失败：${error instanceof Error ? error.message : '未知错误'}`)
  process.exitCode = 1
}
