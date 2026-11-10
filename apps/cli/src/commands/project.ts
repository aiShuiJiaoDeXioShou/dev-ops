import { createIdempotencyKey, type ApiBody } from '@dev-ops/api-client'
import type { Command } from 'commander'
import { businessContext, globalsOf, printBusinessResult, resolveTeamId } from '../lib/command.ts'
import { resolvePagination, type GlobalOptions } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'

/** 项目状态，与平台契约一致。 */
type ProjectStatus = 'active' | 'paused' | 'ended'

interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

interface ListResult<T> {
  data: PageResult<T>
  requestId: string
}

interface ProjectListOptions {
  search?: string
  status?: string
}

interface ProjectCreateOptions {
  name?: string
  description?: string
  owner?: string
}

interface ProjectUpdateOptions {
  name?: string
  description?: string
  owner?: string
  status?: string
  reason?: string
  expectedVersion?: string
}

interface RepositoryAvailableOptions {
  search?: string
}

interface RepositoryAddOptions {
  repository?: string
}

interface RepositoryRemoveOptions {
  repository?: string
  reason?: string
}

/** 获取或创建命令组，供其他命令域复用同一组名而不重复注册。 */
function getOrCreateGroup(parent: Command, name: string, description: string): Command {
  const existing = parent.commands.find((command) => command.name() === name)
  if (existing) return existing
  return parent.command(name).description(description)
}

/** 校验项目状态取值。 */
function parseProjectStatus(value: string): ProjectStatus {
  switch (value) {
    case 'active':
    case 'paused':
    case 'ended':
      return value
    default:
      throw new CliError('--status 必须是 active、paused 或 ended', 2, { code: 'INVALID_STATUS' })
  }
}

/** 读取必填文本选项；空值按参数错误处理。 */
function requireText(value: string | undefined, message: string): string {
  const text = value?.trim()
  if (text === undefined || text === '') throw new CliError(message, 2, { code: 'MISSING_OPTION' })
  return text
}

/** 读取可选文本选项，去掉首尾空白并将空串视为未提供。 */
function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

/** 解析正整数选项。 */
function parsePositiveInteger(value: string, optionName: string): number {
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
    throw new CliError(`${optionName} 必须是正整数`, 2, { code: 'INVALID_NUMBER' })
  }
  return number
}

/** 构造写请求选项：显式 --idempotency-key 优先，否则生成一次性幂等键。 */
function writeOptions(globals: GlobalOptions): { idempotencyKey: string } {
  return { idempotencyKey: globals.idempotencyKey ?? createIdempotencyKey() }
}

/** 危险操作确认：委托给 CLI 统一确认函数。 */
async function requireConfirmation(globals: GlobalOptions, message: string): Promise<void> {
  await confirmDangerous({ yes: globals.yes === true, json: globals.json === true, message })
}

/**
 * 逐页读取全部列表，直到服务端返回的总数或空页为止。
 * @param fetchPage 按页码读取一页的回调。
 * @returns 合并后的列表数据与最后一次请求标识；不静默截断。
 * @throws 任意一页请求失败时向上抛出，不返回部分结果。
 */
async function fetchAllPages<T>(fetchPage: (page: number) => Promise<ListResult<T>>): Promise<ListResult<T>> {
  const items: T[] = []
  let page = 1
  for (;;) {
    const result = await fetchPage(page)
    items.push(...result.data.items)
    if (result.data.items.length === 0 || items.length >= result.data.total) {
      return {
        data: { items, page: 1, pageSize: items.length, total: result.data.total },
        requestId: result.requestId,
      }
    }
    page += 1
  }
}

/**
 * 注册 `devops project` 命令组：项目查询、创建编辑、统计与仓库关联。
 * @param program 根命令，用于挂载命令组。
 * @param context CLI 执行上下文，提供环境与输出通道。
 * @returns 无返回值；命令仅注册动作，解析时再解析认证配置并发起请求。
 * @remarks `project` 与 `project repository` 组按“查找或创建”注册，供 git/code 命令域复用。
 */
export function registerProjectCommands(program: Command, context: CliContext): void {
  const project = getOrCreateGroup(program, 'project', '管理项目')
  const repository = getOrCreateGroup(project, 'repository', '管理项目关联仓库')

  project
    .command('list')
    .description('列出当前团队项目，支持搜索、状态筛选与分页')
    .option('--search <text>', '按项目名称搜索')
    .option('--status <status>', '按状态筛选：active、paused 或 ended')
    .action(async (_options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<ProjectListOptions>()
      const search = optionalText(options.search)
      const status = options.status === undefined ? undefined : parseProjectStatus(options.status)
      const pagination = resolvePagination(globals)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const query = {
        ...(search === undefined ? {} : { search }),
        ...(status === undefined ? {} : { status }),
        page: pagination.page,
        pageSize: pagination.pageSize,
      }
      const result = pagination.all
        ? await fetchAllPages((page) => business.client.listProjects(teamId, { ...query, page }))
        : await business.client.listProjects(teamId, query)
      printBusinessResult(context, globals, result, true)
    })

  project
    .command('get')
    .argument('<projectId>', '项目标识')
    .description('读取项目详情')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.getProject(projectId)
      printBusinessResult(context, business.globals, result)
    })

  project
    .command('create')
    .description('创建项目')
    .option('--name <name>', '项目名称，必填')
    .option('--description <text>', '项目描述')
    .option('--owner <userId>', '负责人用户标识，缺省为当前账号')
    .action(async (_options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<ProjectCreateOptions>()
      const name = requireText(options.name, 'project create 需要 --name')
      const description = optionalText(options.description)
      const ownerUserId = optionalText(options.owner)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const body: ApiBody<'/api/v1/teams/{teamId}/projects', 'post'> = {
        name,
        ...(description === undefined ? {} : { description }),
        ...(ownerUserId === undefined ? {} : { ownerUserId }),
      }
      const result = await business.client.createProject(teamId, body, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })

  project
    .command('update')
    .argument('<projectId>', '项目标识')
    .description('编辑项目资料或状态；状态变更必须提供 --reason，默认读取当前版本')
    .option('--name <name>', '新的项目名称')
    .option('--description <text>', '新的项目描述，传空字符串表示清空')
    .option('--owner <userId>', '新的负责人用户标识')
    .option('--status <status>', '新的项目状态：active、paused 或 ended')
    .option('--reason <reason>', '状态变更原因，必须与 --status 一起使用')
    .option('--expected-version <version>', '期望的项目版本号，用于乐观锁校验')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<ProjectUpdateOptions>()
      const name = optionalText(options.name)
      const description = options.description === undefined ? undefined : options.description.trim()
      const ownerUserId = optionalText(options.owner)
      const rawStatus = optionalText(options.status)
      const reason = optionalText(options.reason)
      const expectedVersion =
        options.expectedVersion === undefined
          ? undefined
          : parsePositiveInteger(options.expectedVersion, '--expected-version')
      if (rawStatus === undefined && reason !== undefined) {
        throw new CliError('--reason 只能与 --status 一起使用', 2, { code: 'INVALID_REASON' })
      }
      let status: ProjectStatus | undefined
      let statusReason: string | undefined
      if (rawStatus !== undefined) {
        status = parseProjectStatus(rawStatus)
        if (reason === undefined) {
          throw new CliError('project update 变更状态必须提供 --reason', 2, { code: 'MISSING_REASON' })
        }
        statusReason = reason
      }
      if (name === undefined && description === undefined && ownerUserId === undefined && status === undefined) {
        throw new CliError('至少需要提供一个更新字段：--name、--description、--owner 或 --status', 2, {
          code: 'NO_UPDATE_FIELDS',
        })
      }
      const business = await businessContext(command, context)
      const version =
        expectedVersion === undefined ? (await business.client.getProject(projectId)).data.version : expectedVersion
      const body: ApiBody<'/api/v1/projects/{projectId}/update', 'post'> = {
        version,
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description: description === '' ? null : description }),
        ...(ownerUserId === undefined ? {} : { ownerUserId }),
        ...(status === undefined ? {} : { status }),
        ...(statusReason === undefined ? {} : { statusReason }),
      }
      const result = await business.client.updateProject(projectId, body, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })

  project
    .command('stats')
    .argument('<projectId>', '项目标识')
    .description('读取项目统计')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.getProjectStats(projectId)
      printBusinessResult(context, business.globals, result)
    })

  repository
    .command('list')
    .argument('<projectId>', '项目标识')
    .description('列出项目已关联仓库')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.listProjectRepositories(projectId)
      printBusinessResult(context, business.globals, result, true)
    })

  repository
    .command('available')
    .argument('<projectId>', '项目标识')
    .description('列出可关联仓库，支持搜索与分页')
    .option('--search <text>', '按仓库名称或命名空间搜索')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<RepositoryAvailableOptions>()
      const search = optionalText(options.search)
      const pagination = resolvePagination(globals)
      const business = await businessContext(command, context)
      const query = {
        ...(search === undefined ? {} : { search }),
        page: pagination.page,
        pageSize: pagination.pageSize,
      }
      const result = pagination.all
        ? await fetchAllPages((page) => business.client.listAvailableRepositories(projectId, { ...query, page }))
        : await business.client.listAvailableRepositories(projectId, query)
      printBusinessResult(context, globals, result, true)
    })

  repository
    .command('add')
    .argument('<projectId>', '项目标识')
    .description('关联已授权仓库到项目')
    .option('--repository <repositoryId>', '要关联的仓库标识，必填')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<RepositoryAddOptions>()
      const repositoryId = requireText(options.repository, 'project repository add 需要 --repository')
      const business = await businessContext(command, context)
      const result = await business.client.linkRepository(projectId, { repositoryId }, writeOptions(globals))
      printBusinessResult(context, globals, result, true)
    })

  repository
    .command('remove')
    .argument('<projectId>', '项目标识')
    .description('移除项目仓库关联；危险操作，需 --reason 与 --yes')
    .option('--repository <repositoryId>', '要移除关联的仓库标识，必填')
    .option('--reason <reason>', '移除原因，必填')
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<RepositoryRemoveOptions>()
      const repositoryId = requireText(options.repository, 'project repository remove 需要 --repository')
      const reason = requireText(options.reason, 'project repository remove 需要 --reason')
      await requireConfirmation(globals, `确认移除项目 ${projectId} 与仓库 ${repositoryId} 的关联？`)
      const business = await businessContext(command, context)
      const result = await business.client.unlinkRepository(projectId, repositoryId, { reason }, writeOptions(globals))
      printBusinessResult(context, globals, result, true)
    })
}
