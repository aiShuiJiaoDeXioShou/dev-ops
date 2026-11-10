import { parseArgs } from 'node:util'
import { checkHealth } from './commands/health.ts'

const DEFAULT_SERVER = 'http://127.0.0.1:3001'
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 300_000

const HELP = `dev-ops：项目开发平台命令行工具

用法：
  dev-ops --help
  dev-ops --version
  dev-ops health [--server <地址>] [--timeout <毫秒>] [--json]

命令：
  health            检查后端进程是否存活，不检查数据库

选项：
  -h, --help        显示帮助
  -v, --version     显示版本
  --server <地址>   服务基础地址，优先于 DEV_OPS_SERVER 环境变量
                    默认 ${DEFAULT_SERVER}，支持反向代理路径前缀
  --timeout <毫秒>  请求超时，默认 ${DEFAULT_TIMEOUT_MS}，范围 1-${MAX_TIMEOUT_MS}
  --json            成功时输出 JSON，错误写入标准错误流

退出码：0 成功，1 请求或运行失败，2 参数错误。
`

/** 命令执行所需的版本、环境与输出通道，便于测试和嵌入调用。 */
export interface CliContext {
  version: string
  env: NodeJS.ProcessEnv
  stdout: (message: string) => void
  stderr: (message: string) => void
}

function parseHealthOptions(server: string, timeout: string | undefined) {
  let url: URL
  try {
    url = new URL(server)
  } catch {
    throw new Error('服务地址必须是完整的 HTTP 或 HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址仅支持 HTTP/HTTPS，且不能包含凭据、查询参数或片段')
  }

  const timeoutMs = timeout === undefined ? DEFAULT_TIMEOUT_MS : Number(timeout)
  if (
    (timeout !== undefined && !/^\d+$/.test(timeout)) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`超时必须是 1-${MAX_TIMEOUT_MS} 之间的整数毫秒`)
  }
  return { url, timeoutMs }
}

/**
 * 解析并执行命令，统一处理参数错误、请求失败和输出。
 * @param args 不包含 Node 路径和入口文件的命令行参数。
 * @param context 版本信息、环境变量和输出函数；输出函数应保证可写。
 * @returns 成功返回 0，请求或运行失败返回 1，参数错误返回 2。
 * @remarks 无参数时显示帮助；仅 health 命令访问网络，帮助和版本不读取服务配置。
 */
export async function runCli(args: string[], context: CliContext): Promise<number> {
  let options
  try {
    options = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        server: { type: 'string' },
        timeout: { type: 'string' },
        json: { type: 'boolean' },
      },
    })
  } catch {
    context.stderr('错误：参数无法识别或缺少参数值，请运行 dev-ops --help。\n')
    return 2
  }

  const { values, positionals } = options
  const command = positionals[0]
  if (positionals.length > 1 || (command !== undefined && command !== 'health')) {
    context.stderr('错误：未知命令或多余参数，请运行 dev-ops --help。\n')
    return 2
  }
  if (values.help || args.length === 0) {
    context.stdout(HELP)
    return 0
  }
  if (values.version) {
    context.stdout(`${context.version}\n`)
    return 0
  }
  if (command !== 'health') {
    context.stderr('错误：请指定命令，例如 dev-ops health。\n')
    return 2
  }

  let healthOptions
  try {
    healthOptions = parseHealthOptions(values.server ?? context.env.DEV_OPS_SERVER ?? DEFAULT_SERVER, values.timeout)
  } catch (error) {
    context.stderr(`错误：${error instanceof Error ? error.message : '参数无效'}。\n`)
    return 2
  }

  try {
    const result = await checkHealth(healthOptions.url, healthOptions.timeoutMs)
    context.stdout(values.json ? `${JSON.stringify(result)}\n` : '后端运行正常（status: ok）。\n')
    return 0
  } catch (error) {
    context.stderr(`错误：${error instanceof Error ? error.message : '健康检查失败'}。\n`)
    return 1
  }
}
