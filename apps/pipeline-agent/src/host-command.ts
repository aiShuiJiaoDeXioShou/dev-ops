import { spawn } from 'node:child_process'

import type { ContainerExecResult } from './docker.ts'

// 先让发布脚本处理 TERM 并恢复 current，再强制清理拒绝退出的命令。
const TERMINATION_GRACE_MS = 30_000

/**
 * 在宿主机的独立进程组中执行命令，流式转发输出。
 * @param input Bash 参数、环境、工作目录、超时、停止信号和输出回调。
 * @returns 退出码及取消或超时状态；终止时等待进程组退出。
 * @throws 进程无法启动时抛出。
 */
export async function executeHostCommand(input: {
  args: string[]
  env: NodeJS.ProcessEnv
  cwd?: string
  timeoutMs: number
  signal: AbortSignal
  onOutput: (text: string) => void
}): Promise<ContainerExecResult> {
  if (input.signal.aborted) return { exitCode: 1, cancelled: true, timedOut: false }
  const child = spawn('/bin/bash', input.args, {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8').on('data', input.onOutput)
  child.stderr.setEncoding('utf8').on('data', input.onOutput)

  let timedOut = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  function signalGroup(signal: NodeJS.Signals): void {
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        input.onOutput('停止宿主命令进程组失败\n')
      }
    }
  }
  function stop(): void {
    if (forceTimer) return
    signalGroup('SIGTERM')
    forceTimer = setTimeout(() => signalGroup('SIGKILL'), TERMINATION_GRACE_MS)
  }
  const timeout = setTimeout(() => {
    timedOut = true
    stop()
  }, input.timeoutMs)
  input.signal.addEventListener('abort', stop, { once: true })
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => signalGroup('SIGKILL'))
      child.once('close', resolve)
    })
    return { exitCode: code ?? 1, timedOut, cancelled: input.signal.aborted }
  } finally {
    clearTimeout(timeout)
    clearTimeout(forceTimer)
    input.signal.removeEventListener('abort', stop)
  }
}
