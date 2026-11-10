import type { LocalConfig } from './config-file.ts'
import { CliError } from './errors.ts'

export const DEFAULT_SERVER = 'http://127.0.0.1:3001'
export const DEFAULT_TIMEOUT_MS = 5_000
export const MAX_TIMEOUT_MS = 300_000
export const DEFAULT_TEAM: string | undefined = undefined

/** 当前命令可用的全局选项。 */
export interface GlobalOptions {
  server?: string
  timeout?: string
  team?: string
  json?: boolean
  yes?: boolean
  tokenStdin?: boolean
  idempotencyKey?: string
  page?: string
  pageSize?: string
  all?: boolean
}

/**
 * 校验并规范化服务地址。
 * @param value 用户输入/配置值。
 * @returns 保留路径前缀的 URL。
 * @throws 非 HTTP(S)、HTTPS 要求、凭据/查询/片段不合法时抛出参数错误。
 */
export function validateServerUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError('服务地址必须是完整的 HTTP 或 HTTPS URL', 2, { code: 'INVALID_SERVER' })
  }
  const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !isLoopback)) {
    throw new CliError('服务地址必须使用 HTTPS，本机回环地址可使用 HTTP', 2, { code: 'INVALID_SERVER' })
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CliError('服务地址不能包含凭据、查询参数或片段', 2, { code: 'INVALID_SERVER' })
  }
  return url
}

/**
 * 解析请求超时。
 * @param value 命令参数或 undefined。
 * @returns 毫秒数。
 * @throws 非整数或越界时抛出参数错误。
 */
export function resolveTimeout(value: string | undefined): number {
  const timeout = value === undefined ? DEFAULT_TIMEOUT_MS : Number(value)
  if (
    (value !== undefined && !/^\d+$/.test(value)) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new CliError(`超时必须是 1-${MAX_TIMEOUT_MS} 之间的整数毫秒`, 2, { code: 'INVALID_TIMEOUT' })
  }
  return timeout
}

/** 按命令参数 > 环境变量 > 本地配置 > 默认值解析服务地址。 */
export function resolveServerUrl(options: GlobalOptions, env: NodeJS.ProcessEnv, config: LocalConfig): URL {
  const value = options.server ?? env.DEV_OPS_SERVER ?? config.server ?? DEFAULT_SERVER
  return validateServerUrl(value)
}

/** 按命令参数 > 环境变量 > 本地配置 > 唯一团队解析团队标识。 */
export function resolveTeamId(options: GlobalOptions, env: NodeJS.ProcessEnv): string | undefined {
  return options.team ?? env.DEV_OPS_TEAM ?? undefined
}

/** 解析分页参数；--all 与显式分页互斥。 */
export function resolvePagination(options: GlobalOptions): { page: number; pageSize: number; all: boolean } {
  const page = options.page === undefined ? 1 : Number(options.page)
  const pageSize = options.pageSize === undefined ? 20 : Number(options.pageSize)
  if (!Number.isSafeInteger(page) || page < 1) throw new CliError('--page 必须是正整数', 2, { code: 'INVALID_PAGE' })
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new CliError('--page-size 必须是 1-100 的整数', 2, { code: 'INVALID_PAGE_SIZE' })
  }
  if (options.all && (options.page !== undefined || options.pageSize !== undefined)) {
    throw new CliError('--all 不能与 --page/--page-size 同时使用', 2, { code: 'INVALID_PAGINATION' })
  }
  return { page, pageSize, all: options.all === true }
}
