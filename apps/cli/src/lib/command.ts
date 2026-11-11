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

/** 统一列表分页结构。 */
export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

/**
 * 逐页读取全部列表；用于全局 `--all`，避免只取第一页造成静默截断。
 * @param fetchPage 按页码读取一页的函数。
 * @returns 合并后的列表与首个请求标识；页内为空即停止，最多读取 1000 页防止异常远端无限翻页。
 */
export async function collectAllPages<T>(
  fetchPage: (page: number) => Promise<{ data: PageResult<T>; requestId: string }>,
): Promise<{ data: PageResult<T>; requestId: string }> {
  const items: T[] = []
  let page = 1
  let requestId = ''
  let total = 0
  for (;;) {
    const result = await fetchPage(page)
    requestId ||= result.requestId
    items.push(...result.data.items)
    total = result.data.total
    const pageSize = result.data.pageSize
    if (result.data.items.length === 0 || items.length >= total || page >= 1_000) break
    if (pageSize <= 0) break
    page += 1
  }
  return { data: { items, page: 1, pageSize: items.length, total }, requestId }
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
