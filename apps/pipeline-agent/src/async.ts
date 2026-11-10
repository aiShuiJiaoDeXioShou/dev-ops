/** 异步等待与超时工具；Agent 的所有长操作都必须有界。 */

/** 等待任务超时；用于运行级/阶段级超时。 */
export class AsyncTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsyncTimeoutError'
  }
}

/** 等待任务被取消信号中止。 */
export class AsyncAbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsyncAbortError'
  }
}

/**
 * 等待指定毫秒。
 * @param delayMs 等待时长，单位毫秒。
 * @param signal 可选取消信号；中止时提前返回 false。
 * @returns 正常等待完成返回 true，被取消返回 false。
 */
export function sleep(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort)
        resolve(true)
      },
      Math.max(0, delayMs),
    )
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 在超时与取消信号约束下等待一个 Promise。
 * @param task 被等待的任务；超时或取消后任务仍可能在后台完成，由调用方自行清理。
 * @param options 超时毫秒数、可选取消信号与超时错误说明。
 * @returns 任务结果。
 * @throws AsyncTimeoutError 超时；AsyncAbortError 取消；任务自身错误原样抛出。
 */
export function withDeadline<T>(
  task: Promise<T>,
  options: { timeoutMs: number; signal?: AbortSignal; label: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const succeed = (value: T): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = (): void => fail(new AsyncAbortError(`${options.label}已取消`))
    const timer = setTimeout(
      () => fail(new AsyncTimeoutError(`${options.label}超时（${String(options.timeoutMs)}ms）`)),
      Math.max(1, options.timeoutMs),
    )
    options.signal?.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => succeed(value),
      (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
    )
  })
}
