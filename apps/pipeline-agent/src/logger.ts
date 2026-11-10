import type { SecretMasker } from './masking.ts'

/** Agent 日志级别；只用于区分告警与错误，不引入日志框架。 */
export type AgentLogLevel = 'info' | 'warn' | 'error'

/** 统一的 Agent 日志接口；所有输出都会先脱敏，禁止直接写敏感值。 */
export interface AgentLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface AgentLoggerOptions {
  masker: SecretMasker
  /** 输出函数，默认写 stderr；测试可注入以捕获输出。 */
  write?: (line: string) => void
  /** 时间来源，默认当前时间。 */
  now?: () => Date
}

const LEVEL_LABELS: Record<AgentLogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

/**
 * 创建脱敏日志器；日志行格式为 `[pipeline-agent] <时间> <级别> <内容>`。
 * @param options 脱敏器、输出函数与时间来源。
 * @returns 按级别输出的日志器；所有消息在输出前统一脱敏。
 */
export function createAgentLogger(options: AgentLoggerOptions): AgentLogger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`))
  const now = options.now ?? (() => new Date())

  function log(level: AgentLogLevel, message: string): void {
    write(`[pipeline-agent] ${now().toISOString()} ${LEVEL_LABELS[level]} ${options.masker.maskText(message)}`)
  }

  return {
    info: (message: string) => log('info', message),
    warn: (message: string) => log('warn', message),
    error: (message: string) => log('error', message),
  }
}

/** 静默日志器；测试中用于避免输出噪声。 */
export function createSilentLogger(): AgentLogger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}
