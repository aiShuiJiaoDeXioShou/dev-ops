import { mkdir } from 'node:fs/promises'

import { loadAgentConfig } from './config.ts'
import { runAgentDaemon } from './daemon.ts'
import { AGENT_VERSION } from './version.ts'

export { AGENT_VERSION } from './version.ts'

/**
 * Agent 入口：校验配置、创建工作目录、检查 Docker 可用性后进入长驻循环。
 * @returns 进程正常退出时完成；配置、Docker 或协议终止性错误会抛出让入口以非零码退出。
 * @remarks 注册、心跳与租约循环由 daemon 负责；收到 SIGINT/SIGTERM 时停止领取并中断当前租约。
 */
async function main(): Promise<void> {
  const config = loadAgentConfig()
  await mkdir(config.workDir, { recursive: true })
  const controller = new AbortController()
  const stop = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[pipeline-agent] 收到 ${signal}，准备优雅退出\n`)
    controller.abort()
  }
  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))
  process.stdout.write(
    `pipeline-agent ${AGENT_VERSION} starting: platform=${config.platformUrl} labels=${config.labels.join(',')}\n`,
  )
  await runAgentDaemon({ config, signal: controller.signal })
  process.stdout.write(`pipeline-agent ${AGENT_VERSION} stopped\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`pipeline-agent 运行失败：${error instanceof Error ? error.message : '未知错误'}\n`)
  process.exitCode = 1
})
