import { createWorker, type PipelineSchedulerLogger } from '../bootstrap/create-worker.ts'
import { loadConfig } from '../platform/config/env.ts'

const config = loadConfig()
/** 简化的结构化日志：输出 JSON 行，敏感信息由调用方保证不传入。 */
const log: PipelineSchedulerLogger = (level, message, context) => {
  const line = JSON.stringify({ level, message, ...(context ?? {}) })
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}
const worker = createWorker(
  config,
  (code) => {
    log('warn', '数据库空闲连接异常', { code: code ?? 'unknown' })
  },
  log,
)
let closing = false

/**
 * 关闭 Worker；重复信号只执行一次，关闭失败标记退出码。
 * @param signal 触发关闭的信号名。
 */
async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  try {
    await worker.close()
    log('info', 'worker 已关闭', { signal })
  } catch (error) {
    log('error', 'worker 关闭失败', { signal, error: error instanceof Error ? error.message : '未知错误' })
    process.exitCode = 1
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

try {
  await worker.start()
  await new Promise<void>(() => undefined)
} catch (error) {
  log('error', 'pipeline worker 启动失败', { error: error instanceof Error ? error.message : '未知错误' })
  await worker.close()
  process.exitCode = 1
}
