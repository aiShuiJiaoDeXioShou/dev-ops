import { resolve } from 'node:path'
import { z } from 'zod'
import { BotError } from './errors.ts'

const configSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().optional(),
  BOT_MODEL: z.string().trim().min(1).default('deepseek-flash'),
  BOT_DATABASE_PATH: z.string().trim().min(1).default('.data/bot.sqlite'),
  BOT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(120_000),
  BOT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8192).default(2048),
  BOT_WORKSPACE: z.string().trim().min(1).default('.'),
  BOT_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  DEEPSEEK_WEB_BASE_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    })
    .default('https://api.deepseek.com/v1/tools'),
})

export interface BotConfig {
  apiKey: string
  model: string
  databasePath: string
  timeoutMs: number
  maxOutputTokens: number
  workspacePath: string
  toolTimeoutMs: number
  webBaseUrl: string
  bashEnvironment: NodeJS.ProcessEnv
}

/**
 * 集中校验 Bot 配置，读取和管理本地数据时不要求配置模型密钥。
 * @param environment 启动入口提供的环境变量。
 * @param cwd 数据库相对路径的解析基址。
 * @returns 已校验的配置，密钥只供服务端模型适配器使用。
 * @throws 配置不合法时抛出安全错误，不包含输入值。
 */
export function loadConfig(environment: NodeJS.ProcessEnv, cwd = process.cwd()): BotConfig {
  const result = configSchema.safeParse(environment)
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join('、')
    throw new BotError('CONFIG_INVALID', `Bot 配置不合法，请检查：${fields}`)
  }
  return {
    apiKey: result.data.DEEPSEEK_API_KEY ?? '',
    model: result.data.BOT_MODEL,
    databasePath: resolve(cwd, result.data.BOT_DATABASE_PATH),
    timeoutMs: result.data.BOT_TIMEOUT_MS,
    maxOutputTokens: result.data.BOT_MAX_OUTPUT_TOKENS,
    workspacePath: resolve(cwd, result.data.BOT_WORKSPACE),
    toolTimeoutMs: result.data.BOT_TOOL_TIMEOUT_MS,
    webBaseUrl: result.data.DEEPSEEK_WEB_BASE_URL.replace(/\/+$/u, ''),
    // 子进程只继承运行所需的基础环境，避免 env 等普通命令意外输出模型密钥。
    bashEnvironment: Object.fromEntries(
      ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TZ'].flatMap((name) =>
        environment[name] === undefined ? [] : [[name, environment[name]]],
      ),
    ),
  }
}
