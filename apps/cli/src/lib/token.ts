import type { GlobalOptions } from './config.ts'
import type { LocalConfig } from './config-file.ts'
import { CliError } from './errors.ts'

export const TOKEN_PREFIX = 'devops_pat_'

function normalizeToken(value: string, source: string): string {
  const token = value.trim()
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(`${source}不是有效的 API Token`, 1, { code: 'TOKEN_INVALID' })
  }
  return token
}

/**
 * 解析本次命令使用的 API Token。
 * @param options 全局选项。
 * @param env 进程环境。
 * @param config 本地配置。
 * @param readStdin 读取标准输入。
 * @param serverOrigin 当前服务 origin，用于校验配置绑定。
 * @returns Token 明文，只保存在内存。
 * @throws 缺少 Token、来源冲突、绑定不匹配时抛出错误。
 */
export async function resolveToken(
  options: GlobalOptions,
  env: NodeJS.ProcessEnv,
  config: LocalConfig,
  readStdin: () => Promise<string>,
  serverOrigin: string,
): Promise<string> {
  if (options.tokenStdin && env.DEV_OPS_TOKEN) {
    throw new CliError('--token-stdin 与 DEV_OPS_TOKEN 不能同时使用', 2, { code: 'TOKEN_SOURCE_CONFLICT' })
  }
  if (options.tokenStdin) return normalizeToken(await readStdin(), '标准输入的 Token ')
  if (env.DEV_OPS_TOKEN) return normalizeToken(env.DEV_OPS_TOKEN, 'DEV_OPS_TOKEN ')
  if (config.token) {
    if (config.tokenServer !== undefined && config.tokenServer !== serverOrigin) {
      throw new CliError('本地 Token 与当前服务地址不匹配，请重新执行 devops config set token', 2, {
        code: 'TOKEN_SERVER_MISMATCH',
      })
    }
    return normalizeToken(config.token, '本地配置的 Token ')
  }
  throw new CliError('未提供 API Token，请先在个人页面创建 Token 并执行 devops config set token', 1, {
    code: 'TOKEN_REQUIRED',
  })
}

/** 对 Token 做掩码，用于配置展示。 */
export function maskToken(token: string): string {
  if (token.length <= 16) return `${token.slice(0, 8)}…`
  return `${token.slice(0, 12)}…${token.slice(-4)}`
}
