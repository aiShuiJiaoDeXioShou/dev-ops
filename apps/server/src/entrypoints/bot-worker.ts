import { runBot } from '@dev-ops/devops-bot'
import { createBotWorker } from '../bootstrap/create-bot-worker.ts'
import { loadConfig } from '../platform/config/env.ts'

const config = loadConfig()
const worker = createBotWorker(config, runBot, (level, message, context) => {
  const output = level === 'error' ? process.stderr : process.stdout
  output.write(`${JSON.stringify({ level, message, ...context })}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.close().catch(() => {
      process.stderr.write('Bot 执行服务关闭失败\n')
      process.exitCode = 1
    })
  })
}
try {
  await worker.start()
} catch {
  process.stderr.write('Bot 执行服务启动失败\n')
  await worker.close()
  process.exitCode = 1
}
