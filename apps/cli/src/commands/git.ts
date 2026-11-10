import { createIdempotencyKey, type ApiBody } from '@dev-ops/api-client'
import { Command } from 'commander'
import {
  businessContext,
  globalsOf,
  printBusinessResult,
  resolveTeamId,
  type BusinessCommandContext,
} from '../lib/command.ts'
import { resolvePagination, type GlobalOptions } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'
import { printSuccess } from '../lib/output.ts'

const GIT_PROVIDERS = ['github', 'gitea'] as const
/** Gitea Token 的读取环境变量；命令行参数不作为秘密通道。 */
const GIT_TOKEN_ENV = 'DEV_OPS_GIT_TOKEN'
/** --all 逐页读取时每页数量，与服务端上限保持一致。 */
const ALL_REPOSITORIES_PAGE_SIZE = 100

type GitProvider = (typeof GIT_PROVIDERS)[number]

interface CreateConnectionOptions {
  provider: string
  name: string
  instanceUrl?: string
}

interface RepositoryListOptions {
  connection: string
  search?: string
}

interface RevokeOptions {
  reason: string
}

/** GitHub App 创建连接响应：只返回浏览器授权地址，尚未完成安装。 */
interface GitHubAuthorization {
  authorizationUrl: string
  expiresAt: string
}

/** 读取 commander 动作回调末尾的命令实例；回调参数随位置参数数量变化。 */
function lastCommand(args: unknown[]): Command {
  const command = args.at(-1)
  if (!(command instanceof Command)) throw new Error('commander 动作回调缺少命令实例')
  return command
}

/** 校验必填文本参数非空，返回去空白后的值；空值按参数错误处理。 */
function requireText(value: string, label: string, code: string): string {
  const text = value.trim()
  if (text === '') throw new CliError(`${label}不能为空`, 2, { code })
  return text
}

/** 校验 --provider 取值并收窄为 Git 提供方。 */
function parseProvider(value: string): GitProvider {
  const provider = GIT_PROVIDERS.find((item) => item === value)
  if (provider === undefined) {
    throw new CliError('--provider 必须是 github 或 gitea', 2, { code: 'INVALID_PROVIDER' })
  }
  return provider
}

/** 校验 Gitea 实例地址：完整 HTTP(S)、不含凭据/查询/片段，并去掉尾部斜杠。 */
function requireInstanceUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new CliError('Gitea 连接需要 --instance-url', 2, { code: 'MISSING_INSTANCE_URL' })
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError('--instance-url 必须是完整的 HTTP 或 HTTPS 地址', 2, { code: 'INVALID_INSTANCE_URL' })
  }
  const hasCredentials = url.username !== '' || url.password !== ''
  const hasQueryOrFragment = url.search !== '' || url.hash !== ''
  if (!['http:', 'https:'].includes(url.protocol) || hasCredentials || hasQueryOrFragment) {
    throw new CliError('--instance-url 必须是 HTTP 或 HTTPS 地址，且不能包含凭据、查询参数或片段', 2, {
      code: 'INVALID_INSTANCE_URL',
    })
  }
  return value.trim().replace(/\/+$/, '')
}

/**
 * 读取 Gitea Token：环境变量优先，其次标准输入；不进入命令行参数与输出。
 * @param context CLI 上下文，提供环境变量与标准输入读取函数。
 * @returns 去空白后的 Token 明文，只保存在内存并用于本次请求。
 * @throws 两种来源都没有内容时抛出参数错误，不打印任何凭据。
 */
async function readGitToken(context: CliContext): Promise<string> {
  const fromEnv = context.env[GIT_TOKEN_ENV]?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const fromStdin = (await (context.readStdin ?? (async () => ''))()).trim()
  if (fromStdin === '') {
    throw new CliError(`缺少 Gitea Token：请设置 ${GIT_TOKEN_ENV} 或通过标准输入提供`, 2, {
      code: 'MISSING_GIT_TOKEN',
    })
  }
  return fromStdin
}

/** 生成 POST 写请求选项；默认每次自动生成幂等键，可由全局参数覆盖。 */
function writeOptions(globals: GlobalOptions): { idempotencyKey: string } {
  return { idempotencyKey: globals.idempotencyKey ?? createIdempotencyKey() }
}

/** 危险操作统一确认；非交互环境要求 --yes，且不发送写请求。 */
async function requireConfirmation(globals: GlobalOptions, action: string): Promise<void> {
  await confirmDangerous({
    yes: globals.yes === true,
    json: globals.json === true,
    message: `${action}属于危险操作，确认继续？`,
  })
}

/** 判断创建连接响应是否为 GitHub App 授权地址（浏览器安装尚未完成）。 */
function isGitHubAuthorization(data: unknown): data is GitHubAuthorization {
  if (typeof data !== 'object' || data === null) return false
  return (
    'authorizationUrl' in data &&
    typeof data.authorizationUrl === 'string' &&
    'expiresAt' in data &&
    typeof data.expiresAt === 'string'
  )
}

/**
 * 逐页读取连接下全部仓库，供 --all 使用。
 * @param business 已认证命令上下文。
 * @param connectionId Git 连接标识。
 * @param search 仓库名或命名空间搜索词。
 * @returns 合并后的列表数据与最后一次请求标识。
 * @remarks 按服务端 total 终止，避免静默截断；不缓存结果。
 */
async function fetchAllRepositories(
  business: BusinessCommandContext,
  connectionId: string,
  search: string | undefined,
): Promise<{ data: unknown; requestId: string }> {
  const items: unknown[] = []
  let total = 0
  let requestId = ''
  for (let page = 1; ; page += 1) {
    const result = await business.client.listGitConnectionRepositories(connectionId, {
      search,
      page,
      pageSize: ALL_REPOSITORIES_PAGE_SIZE,
    })
    requestId = result.requestId
    total = result.data.total
    items.push(...result.data.items)
    if (result.data.items.length < ALL_REPOSITORIES_PAGE_SIZE || items.length >= total) break
  }
  return { data: { items, page: 1, pageSize: items.length, total }, requestId }
}

/**
 * 注册 `devops git` 命令组：Git 提供方、连接管理与连接下仓库查询。
 * @param program 根命令实例。
 * @param context CLI 上下文，提供环境变量、标准输入与输出通道。
 * @returns 无返回值；命令注册到传入的 program。
 * @remarks Gitea Token 只从环境变量或标准输入读取，不进入 argv、帮助与输出；
 * GitHub App 创建只输出浏览器授权地址，完成安装需在浏览器操作后用 check 确认。
 */
export function registerGitCommands(program: Command, context: CliContext): void {
  const git = program.command('git').description('管理 Git 提供方、连接与仓库')

  const provider = git.command('provider').description('Git 提供方')
  provider
    .command('list')
    .description('列出支持的 Git 提供方')
    .action(async (...args: unknown[]) => {
      const command = lastCommand(args)
      const business = await businessContext(command, context)
      const result = await business.client.listGitProviders()
      printBusinessResult(context, business.globals, result, true)
    })

  const connection = git.command('connection').description('Git 连接')

  connection
    .command('list')
    .description('列出当前团队的 Git 连接（不包含秘密）')
    .action(async (...args: unknown[]) => {
      const command = lastCommand(args)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const result = await business.client.listGitConnections(teamId)
      printBusinessResult(context, business.globals, result, true)
    })

  connection
    .command('create')
    .description('创建 Git 连接；Gitea Token 从环境变量或标准输入读取且不回显')
    .requiredOption('--provider <provider>', 'Git 提供方：github 或 gitea')
    .requiredOption('--name <name>', '连接名称')
    .option('--instance-url <url>', 'Gitea 实例地址，provider 为 gitea 时必填')
    .action(async (...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<CreateConnectionOptions>()
      const providerKey = parseProvider(options.provider)
      const name = requireText(options.name, '--name', 'MISSING_NAME')
      const body: ApiBody<'/api/v1/teams/{teamId}/git-connections', 'post'> = { providerKey, name }
      if (providerKey === 'gitea') {
        body.instanceUrl = requireInstanceUrl(options.instanceUrl)
        body.token = await readGitToken(context)
      }
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const result = await business.client.createGitConnection(teamId, body, writeOptions(business.globals))
      const data = result.data
      if (!isGitHubAuthorization(data)) {
        printBusinessResult(context, business.globals, result)
        return
      }
      printSuccess(
        { json: business.globals.json === true, stdout: context.stdout },
        data,
        result.requestId,
        () =>
          `GitHub App 授权地址：${data.authorizationUrl}\n授权有效期至：${data.expiresAt}\n请在浏览器完成安装授权后运行 devops git connection check <connectionId> 确认。\n`,
      )
    })

  connection
    .command('check')
    .argument('<connectionId>', 'Git 连接标识')
    .description('检查连接凭据与授权状态')
    .action(async (connectionId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const business = await businessContext(command, context)
      const result = await business.client.checkGitConnection(connectionId, writeOptions(business.globals))
      printBusinessResult(context, business.globals, result)
    })

  connection
    .command('sync')
    .argument('<connectionId>', 'Git 连接标识')
    .description('同步连接下的仓库范围')
    .action(async (connectionId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const business = await businessContext(command, context)
      const result = await business.client.syncGitRepositories(connectionId, writeOptions(business.globals))
      printBusinessResult(context, business.globals, result)
    })

  connection
    .command('revoke')
    .argument('<connectionId>', 'Git 连接标识')
    .requiredOption('--reason <reason>', '撤销原因，必填且不自动填充')
    .description('撤销 Git 连接（危险操作，需要 --reason 与 --yes）')
    .action(async (connectionId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<RevokeOptions>()
      const reason = requireText(options.reason, '--reason', 'MISSING_REASON')
      await requireConfirmation(globalsOf(command), '撤销 Git 连接')
      const business = await businessContext(command, context)
      const result = await business.client.revokeGitConnection(connectionId, { reason }, writeOptions(business.globals))
      printBusinessResult(context, business.globals, result)
    })

  const repository = git.command('repository').description('Git 连接下的仓库')
  repository
    .command('list')
    .requiredOption('--connection <connectionId>', '所属 Git 连接标识')
    .option('--search <keyword>', '按仓库名或命名空间搜索')
    .description('列出连接下已同步的仓库')
    .action(async (...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<RepositoryListOptions>()
      const business = await businessContext(command, context)
      const pagination = resolvePagination(business.globals)
      if (pagination.all) {
        const result = await fetchAllRepositories(business, options.connection, options.search)
        printBusinessResult(context, business.globals, result, true)
        return
      }
      const result = await business.client.listGitConnectionRepositories(options.connection, {
        search: options.search,
        page: pagination.page,
        pageSize: pagination.pageSize,
      })
      printBusinessResult(context, business.globals, result, true)
    })
}
