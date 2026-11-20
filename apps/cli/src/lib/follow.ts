import { setTimeout as delay } from 'node:timers/promises'
import type { Command } from 'commander'
import { CliError } from './errors.ts'

/**
 * 注册等待时限选项，单次 HTTP 超时仍由全局 --timeout 控制。
 * @param command 支持等待或跟踪的命令。
 * @returns 原命令，便于继续注册选项。
 */
export function withWaitTimeout(command: Command): Command {
  return command.option('--wait-timeout <ms>', '本次等待总时限，默认 1800000 毫秒')
}

/**
 * 在限定时段内轮询，并在结束后移除本地中断监听。
 * @param command 读取等待时限的命令。
 * @param run 接收取消信号的读取循环。
 * @returns 读取循环结果。
 * @throws 超时和 Ctrl-C 分别返回可判别的 CLI 错误。
 */
export async function withPolling<T>(command: Command, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { waitTimeout } = command.opts<{ waitTimeout?: string }>()
  const ms = waitTimeout === undefined ? 1_800_000 : Number(waitTimeout)
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 2_147_483_647) {
    throw new CliError('--wait-timeout 必须是 1 至 2147483647 之间的整数毫秒', 2, { code: 'INVALID_TIMEOUT' })
  }
  const interrupt = new AbortController()
  const timeout = AbortSignal.timeout(ms)
  const signal = AbortSignal.any([interrupt.signal, timeout])
  const onInterrupt = () => interrupt.abort()
  process.once('SIGINT', onInterrupt)
  try {
    return await run(signal)
  } catch (error) {
    if (interrupt.signal.aborted) throw new CliError('已结束本地等待', 1, { code: 'INTERRUPTED' })
    if (timeout.aborted) throw new CliError('等待服务端结果超时', 1, { code: 'WAIT_TIMEOUT' })
    throw error
  } finally {
    process.off('SIGINT', onInterrupt)
  }
}

/**
 * 为没有待处理数据的轮询设置可取消的间隔。
 * @param signal 等待命令的取消信号。
 * @returns 间隔结束后完成，用户中断或超时时抛出取消原因。
 */
export async function pollInterval(signal: AbortSignal): Promise<void> {
  await delay(1000, undefined, { signal })
}
