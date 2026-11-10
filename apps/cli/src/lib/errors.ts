import { RequestError } from '@dev-ops/api-client'

/** CLI 运行期错误；exitCode 固定为业务失败 1 或参数/本地配置错误 2。 */
export class CliError extends Error {
  readonly exitCode: 1 | 2
  readonly code?: string
  readonly requestId?: string | null

  constructor(message: string, exitCode: 1 | 2, options: { code?: string; requestId?: string | null } = {}) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
    this.code = options.code
    this.requestId = options.requestId
  }
}

export interface ErrorOutput {
  code: string
  message: string
  requestId?: string
  exitCode: 1 | 2
}

/**
 * 将未知异常转换为 CLI 可展示的错误输出；不暴露堆栈、Token 或原始响应。
 * @param error 捕获的异常。
 * @returns 业务码、用户消息、可用请求标识与退出码。
 */
export function toErrorOutput(error: unknown): ErrorOutput {
  if (error instanceof CliError) {
    return {
      code: error.code ?? 'CLI_ERROR',
      message: error.message,
      ...(error.requestId ? { requestId: error.requestId } : {}),
      exitCode: error.exitCode,
    }
  }
  if (error instanceof RequestError) {
    const requestId = error.requestId ?? undefined
    if (error.code === 'BUSINESS_ERROR') {
      return {
        code: error.serverCode ?? 'BUSINESS_ERROR',
        message: error.message,
        ...(requestId ? { requestId } : {}),
        exitCode: 1,
      }
    }
    return {
      code: error.code,
      message: error.message,
      ...(requestId ? { requestId } : {}),
      exitCode: 1,
    }
  }
  if (error instanceof Error) {
    return { code: 'CLI_ERROR', message: error.message || '命令执行失败', exitCode: 1 }
  }
  return { code: 'CLI_ERROR', message: '命令执行失败', exitCode: 1 }
}

/**
 * 输出失败信息：默认中文文本，JSON 模式输出结构化错误。
 * @param error 捕获的异常。
 * @param context 输出与 JSON 模式。
 * @returns 进程退出码。
 */
export function reportError(error: unknown, context: { json: boolean; stderr: (message: string) => void }): number {
  const output = toErrorOutput(error)
  if (context.json) {
    context.stderr(
      `${JSON.stringify({
        success: false,
        code: output.code,
        message: output.message,
        ...(output.requestId ? { requestId: output.requestId } : {}),
      })}\n`,
    )
  } else {
    context.stderr(`错误：${output.message}\n`)
  }
  return output.exitCode
}
