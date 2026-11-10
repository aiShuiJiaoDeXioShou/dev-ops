import { readFile } from 'node:fs/promises'
import type { Command } from 'commander'
import type { CliContext } from './context.ts'
import { resolveServerUrl, resolveTimeout, type GlobalOptions } from './config.ts'
import { readLocalConfig } from './config-file.ts'
import { CliError } from './errors.ts'
import { createHttpClient } from './http.ts'
import { normalizeList, printSuccess } from './output.ts'
import { resolveToken } from './token.ts'

/** 已认证业务命令的共享依赖。 */
export interface BusinessCommandContext {
  globals: GlobalOptions
  client: ReturnType<typeof createHttpClient>
  server: URL
  timeoutMs: number
}

/** 读取命令关联的全局选项。 */
export function globalsOf(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>()
}

/** 解析已认证命令的配置、Token 与客户端。 */
export async function businessContext(command: Command, context: CliContext): Promise<BusinessCommandContext> {
  const globals = globalsOf(command)
  const config = await readLocalConfig()
  const server = resolveServerUrl(globals, context.env, config)
  const timeoutMs = resolveTimeout(globals.timeout)
  const token = await resolveToken(globals, context.env, config, context.readStdin ?? (async () => ''), server.origin)
  return { globals, client: createHttpClient(server, timeoutMs, token), server, timeoutMs }
}

/**
 * 输出业务结果；列表统一归一化分页字段。
 * @param context CLI 上下文。
 * @param globals 全局选项。
 * @param result 客户端返回的数据与请求标识。
 * @param normalize 是否按列表归一化，默认 false。
 */
export function printBusinessResult(
  context: CliContext,
  globals: GlobalOptions,
  result: { data: unknown; requestId: string },
  normalize = false,
): void {
  const data = normalize ? normalizeList(result.data) : result.data
  printSuccess({ json: globals.json === true, stdout: context.stdout }, data, result.requestId)
}

/** 解析团队：参数/环境优先，否则通过 /me 自动选择唯一团队。 */
export async function resolveTeamId(context: CliContext, business: BusinessCommandContext): Promise<string> {
  const explicit = business.globals.team ?? context.env.DEV_OPS_TEAM
  if (explicit) return explicit
  const me = await business.client.me()
  const teams = me.data.teams
  if (teams.length === 1) return teams[0]!.id
  if (teams.length === 0) {
    throw new CliError('当前账号未加入任何团队', 1, { code: 'PRECONDITION_FAILED' })
  }
  throw new CliError(
    `当前账号属于多个团队，请使用 --team 或 DEV_OPS_TEAM；可选团队：${teams.map((team) => team.id).join(', ')}`,
    2,
    { code: 'TEAM_REQUIRED' },
  )
}

/** 从文件或标准输入读取长文本；路径为 `-` 时读 stdin。 */
export async function readContent(path: string | undefined, context: CliContext): Promise<string> {
  if (!path) throw new CliError('缺少内容文件参数', 2, { code: 'MISSING_CONTENT' })
  if (path === '-') return (context.readStdin ?? (async () => ''))()
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new CliError(`无法读取内容文件：${path}`, 2, { code: 'CONTENT_READ_FAILED' })
  }
}
