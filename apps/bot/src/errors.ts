/** 预期失败，仅保存可以安全输出给命令行用户的信息。 */
export class BotError extends Error {
  readonly code: string

  /**
   * 创建可展示的 Bot 错误。
   * @param code 稳定的错误分类。
   * @param message 不包含密钥、原始响应和堆栈的中文说明。
   * @returns 错误实例；不产生外部副作用。
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BotError'
    this.code = code
  }
}

/**
 * 将未知异常转换成安全的命令行错误，不输出模型原始错误或内部 SQL。
 * @param error 业务或运行时异常。
 * @returns 可向用户展示的中文信息。
 */
export function errorMessage(error: unknown): string {
  return error instanceof BotError ? error.message : 'Bot 运行失败，请检查本地配置或数据库状态'
}
