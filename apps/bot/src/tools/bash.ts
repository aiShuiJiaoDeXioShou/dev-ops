import { spawn, type ChildProcess } from 'node:child_process'
import { Type } from 'typebox'
import { z } from 'zod'
import type { BotConfig } from '../config.ts'
import { BotError } from '../errors.ts'
import { defineTool, MAX_TOOL_OUTPUT_BYTES } from './common.ts'

function killGroup(child: ChildProcess): void {
  if (!child.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

function runBash(command: string, config: BotConfig, signal: AbortSignal): Promise<{ text: string; isError: boolean }> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], {
      cwd: config.workspacePath,
      env: config.bashEnvironment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    const capture = (chunk: Buffer) => {
      const remaining = MAX_TOOL_OUTPUT_BYTES - size
      if (chunk.length > remaining) truncated = true
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining))
        size += Math.min(remaining, chunk.length)
      }
    }
    const stop = () => {
      try {
        killGroup(child)
      } catch {
        reject(new BotError('BASH_STOP_FAILED', '无法终止命令进程，请手工检查运行状态'))
      }
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.once('error', () => {
      signal.removeEventListener('abort', stop)
      reject(new BotError('BASH_START_FAILED', '无法启动 Bash，请检查 /bin/bash 和工作目录是否存在'))
    })
    child.once('close', (code, exitSignal) => {
      signal.removeEventListener('abort', stop)
      try {
        // 本工具用于有界前台命令，结束后清理同组后代，避免遗留后台进程。
        killGroup(child)
        signal.throwIfAborted()
        resolve({
          text: `退出码：${code ?? '无'}${exitSignal ? `；信号：${exitSignal}` : ''}\n${Buffer.concat(chunks).toString('utf8')}${truncated ? '\n[命令输出已截断]' : ''}`,
          isError: code !== 0,
        })
      } catch (error) {
        reject(error)
      }
    })
  })
}

/**
 * 创建本机 Bash 工具，使用固定工作目录、基础环境和独立进程组。
 * @param config 已校验的工作目录、子进程环境和工具超时。
 * @returns pi 工具；非零退出作为失败，超时或取消会终止进程组，已有副作用不回滚。
 */
export function bashTool(config: BotConfig) {
  return defineTool(config, {
    name: 'bash',
    description:
      '在工作目录运行本机 Bash 命令，返回合并的 stdout/stderr 和退出码。支持管道；非零退出为失败。命令立即生效，不能运行常驻后台服务。',
    parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 16000 }) }),
    async run(input, signal) {
      const { command } = z.object({ command: z.string().trim().min(1).max(16000) }).parse(input)
      return runBash(command, config, signal)
    },
  })
}
