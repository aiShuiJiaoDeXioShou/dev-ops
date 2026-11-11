import { createIdempotencyKey, type ApiBody } from '@dev-ops/api-client'
import { Command } from 'commander'
import { businessContext, globalsOf, printBusinessResult } from '../lib/command.ts'
import type { GlobalOptions } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'

const CODE_REFERENCE_TARGET_TYPES = ['requirement', 'bug'] as const
const CODE_REFERENCE_OBJECT_TYPES = ['commit', 'issue', 'change_request'] as const

type CodeReferenceTargetType = (typeof CODE_REFERENCE_TARGET_TYPES)[number]
type CodeReferenceObjectType = (typeof CODE_REFERENCE_OBJECT_TYPES)[number]

interface RepositoryOptions {
  repository: string
}

interface TreeOptions extends RepositoryOptions {
  branch?: string
}

interface FileOptions extends RepositoryOptions {
  path: string
  branch?: string
}

interface CommitsOptions extends RepositoryOptions {
  ref?: string
}

interface CommitOptions extends RepositoryOptions {
  ref: string
}

interface PullRequestsOptions extends RepositoryOptions {
  state?: string
}

interface PullRequestOptions extends RepositoryOptions {
  number: string
}

interface AddCodeReferenceOptions {
  repository: string
  targetType: string
  targetId: string
  objectType: string
  remoteId: string
}

interface RemoveCodeReferenceOptions {
  reference: string
  reason: string
}

/**
 * 查找或创建命令组。
 * @param parent 父命令。
 * @param name 子命令名。
 * @param description 子命令说明。
 * @returns 已存在或新建的命令组。
 * @remarks `project`/`project repository` 由 project 与 code 两个命令域共享，
 * 直接重复注册会被 commander 拒绝，因此先查找已注册组。
 */
function getOrCreateGroup(parent: Command, name: string, description: string): Command {
  const existing = parent.commands.find((command) => command.name() === name)
  if (existing !== undefined) return existing
  return parent.command(name).description(description)
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

/** 校验用户输入的枚举值并收窄为对应字面量类型；不合法值按参数错误处理。 */
function parseChoice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  const match = allowed.find((item) => item === value)
  if (match === undefined) {
    throw new CliError(`${label}必须是 ${allowed.join(' / ')} 之一`, 2, { code: 'INVALID_ARGUMENT' })
  }
  return match
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

/**
 * 注册代码浏览与代码关联命令：
 * `project repository branches/tree/file`、`project code-reference add/remove`
 * 与顶层 `code-reference refresh`。
 * @param program 根命令实例。
 * @param context CLI 上下文，提供输出通道与凭据来源。
 * @returns 无返回值；命令注册到传入的 program。
 * @remarks 复用 project 命令组；项目、仓库、分支与路径只做本地形态校验，
 * 仓库归属与来源状态由服务端校验，外部失败按统一错误码返回。
 */
export function registerCodeCommands(program: Command, context: CliContext): void {
  const project = getOrCreateGroup(program, 'project', '管理项目')
  const repository = getOrCreateGroup(project, 'repository', '管理项目关联仓库')

  /** 列出分支；`code` 与 `project repository` 两个入口共用同一实现。 */
  const branchesAction = async (projectId: string, ...args: unknown[]) => {
    const command = lastCommand(args)
    const options = command.opts<RepositoryOptions>()
    const business = await businessContext(command, context)
    const result = await business.client.listRepositoryBranches(projectId, options.repository)
    printBusinessResult(context, business.globals, result)
  }

  /** 读取文件树；`code` 与 `project repository` 两个入口共用同一实现。 */
  const treeAction = async (projectId: string, ...args: unknown[]) => {
    const command = lastCommand(args)
    const options = command.opts<TreeOptions>()
    const business = await businessContext(command, context)
    const result = await business.client.listRepositoryTree(
      projectId,
      options.repository,
      options.branch === undefined ? undefined : { branch: options.branch },
    )
    printBusinessResult(context, business.globals, result)
  }

  /** 读取单个文件；`code` 与 `project repository` 两个入口共用同一实现。 */
  const fileAction = async (projectId: string, ...args: unknown[]) => {
    const command = lastCommand(args)
    const options = command.opts<FileOptions>()
    const path = requireText(options.path, '--path', 'MISSING_PATH')
    const branch = options.branch === undefined ? {} : { branch: options.branch }
    const business = await businessContext(command, context)
    const result = await business.client.getRepositoryFile(projectId, options.repository, { path, ...branch })
    printBusinessResult(context, business.globals, result)
  }

  repository
    .command('branches')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .description('列出项目关联仓库的分支')
    .action(branchesAction)

  repository
    .command('tree')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .option('--branch <branch>', '分支名，缺省使用仓库默认分支')
    .description('读取项目关联仓库的文件树')
    .action(treeAction)

  repository
    .command('file')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .requiredOption('--path <path>', '文件路径，相对仓库根目录')
    .option('--branch <branch>', '分支名，缺省使用仓库默认分支')
    .description('读取项目关联仓库的单个文件内容')
    .action(fileAction)

  repository
    .command('commits')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .option('--ref <ref>', '提交引用，缺省使用仓库默认分支')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<CommitsOptions>()
      const business = await businessContext(command, context)
      const pagination = business.globals
      const result = await business.client.listCommits(projectId, options.repository, {
        ...(options.ref ? { ref: options.ref } : {}),
        ...(pagination.page ? { page: Number(pagination.page) } : {}),
        ...(pagination.pageSize ? { pageSize: Number(pagination.pageSize) } : {}),
      })
      printBusinessResult(context, business.globals, result)
    })

  repository
    .command('commit')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .requiredOption('--ref <ref>', '提交 SHA 或引用')
    .description('读取单个提交详情与变更文件')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<CommitOptions>()
      const business = await businessContext(command, context)
      const result = await business.client.getCommit(projectId, options.repository, options.ref)
      printBusinessResult(context, business.globals, result)
    })

  repository
    .command('pull-requests')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .option('--state <state>', 'PR 状态：open、closed 或 all')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<PullRequestsOptions>()
      const state = options.state === undefined ? undefined : requireText(options.state, '--state', 'INVALID_ARGUMENT')
      const business = await businessContext(command, context)
      const pagination = business.globals
      const result = await business.client.listPullRequests(projectId, options.repository, {
        ...(state ? { state: state as 'open' | 'closed' | 'all' } : {}),
        ...(pagination.page ? { page: Number(pagination.page) } : {}),
        ...(pagination.pageSize ? { pageSize: Number(pagination.pageSize) } : {}),
      })
      printBusinessResult(context, business.globals, result)
    })

  repository
    .command('pull-request')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .requiredOption('--number <number>', 'PR 编号')
    .description('读取 PR 详情与变更文件')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<PullRequestOptions>()
      const number = requireText(options.number, '--number', 'MISSING_PR_NUMBER')
      const business = await businessContext(command, context)
      const result = await business.client.getPullRequest(projectId, options.repository, number)
      printBusinessResult(context, business.globals, result)
    })

  repository
    .command('pull-request-diff')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .requiredOption('--number <number>', 'PR 编号')
    .description('读取 PR 差异文本')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<PullRequestOptions>()
      const number = requireText(options.number, '--number', 'MISSING_PR_NUMBER')
      const business = await businessContext(command, context)
      const result = await business.client.getPullRequestDiff(projectId, options.repository, number)
      printBusinessResult(context, business.globals, result)
    })

  // 顶层 `code` 是 `project repository` 的只读别名，README 与脚本可用更短入口。
  const code = getOrCreateGroup(program, 'code', '浏览项目关联仓库的代码与 PR')
  code
    .command('branches')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .description('列出项目关联仓库的分支')
    .action(branchesAction)
  code
    .command('tree')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .option('--branch <branch>', '分支名，缺省使用仓库默认分支')
    .description('读取项目关联仓库的文件树')
    .action(treeAction)
  code
    .command('file')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .requiredOption('--path <path>', '文件路径，相对仓库根目录')
    .option('--branch <branch>', '分支名，缺省使用仓库默认分支')
    .description('读取项目关联仓库的单个文件内容')
    .action(fileAction)
  code
    .command('commits')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .option('--ref <ref>', '提交引用，缺省使用仓库默认分支')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<CommitsOptions>()
      const business = await businessContext(command, context)
      const pagination = business.globals
      const result = await business.client.listCommits(projectId, options.repository, {
        ...(options.ref ? { ref: options.ref } : {}),
        ...(pagination.page ? { page: Number(pagination.page) } : {}),
        ...(pagination.pageSize ? { pageSize: Number(pagination.pageSize) } : {}),
      })
      printBusinessResult(context, business.globals, result)
    })
  code
    .command('pull-requests')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .option('--state <state>', 'PR 状态：open、closed 或 all')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<PullRequestsOptions>()
      const state = options.state === undefined ? undefined : requireText(options.state, '--state', 'INVALID_ARGUMENT')
      const business = await businessContext(command, context)
      const pagination = business.globals
      const result = await business.client.listPullRequests(projectId, options.repository, {
        ...(state ? { state: state as 'open' | 'closed' | 'all' } : {}),
        ...(pagination.page ? { page: Number(pagination.page) } : {}),
        ...(pagination.pageSize ? { pageSize: Number(pagination.pageSize) } : {}),
      })
      printBusinessResult(context, business.globals, result)
    })

  const codeReference = getOrCreateGroup(project, 'code-reference', '管理需求/Bug 的代码关联')

  codeReference
    .command('add')
    .argument('<projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '项目关联仓库标识')
    .requiredOption('--target-type <type>', '关联目标类型：requirement 或 bug')
    .requiredOption('--target-id <id>', '关联目标（需求或 Bug）标识')
    .requiredOption('--object-type <type>', '来源对象类型：commit、issue 或 change_request')
    .requiredOption('--remote-id <id>', '来源对象的远端标识')
    .description('添加 Commit/Issue/PR 代码关联；服务端会核对来源对象')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<AddCodeReferenceOptions>()
      const targetType = parseChoice<CodeReferenceTargetType>(
        options.targetType,
        CODE_REFERENCE_TARGET_TYPES,
        '--target-type ',
      )
      const objectType = parseChoice<CodeReferenceObjectType>(
        options.objectType,
        CODE_REFERENCE_OBJECT_TYPES,
        '--object-type ',
      )
      const body: ApiBody<'/api/v1/projects/{projectId}/code-references', 'post'> = {
        targetType,
        targetId: requireText(options.targetId, '--target-id', 'MISSING_TARGET_ID'),
        repositoryId: requireText(options.repository, '--repository', 'MISSING_REPOSITORY'),
        objectType,
        remoteId: requireText(options.remoteId, '--remote-id', 'MISSING_REMOTE_ID'),
      }
      const business = await businessContext(command, context)
      const result = await business.client.createCodeReference(projectId, body, writeOptions(business.globals))
      printBusinessResult(context, business.globals, result)
    })

  codeReference
    .command('remove')
    .argument('<projectId>', '项目标识')
    .requiredOption('--reference <codeReferenceId>', '代码关联标识')
    .requiredOption('--reason <reason>', '移除原因，必填且不自动填充')
    .description('移除代码关联（危险操作，需要 --reason 与 --yes）')
    .action(async (projectId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const options = command.opts<RemoveCodeReferenceOptions>()
      const referenceId = requireText(options.reference, '--reference', 'MISSING_REFERENCE')
      const reason = requireText(options.reason, '--reason', 'MISSING_REASON')
      await requireConfirmation(globalsOf(command), `移除项目 ${projectId} 的代码关联`)
      const business = await businessContext(command, context)
      const result = await business.client.removeCodeReference(referenceId, { reason }, writeOptions(business.globals))
      printBusinessResult(context, business.globals, result)
    })

  program
    .command('code-reference')
    .description('刷新代码关联的来源状态')
    .command('refresh')
    .argument('<codeReferenceId>', '代码关联标识')
    .description('刷新 Commit/Issue/PR 关联的来源状态；来源失败时不展示旧值')
    .action(async (codeReferenceId: string, ...args: unknown[]) => {
      const command = lastCommand(args)
      const business = await businessContext(command, context)
      const result = await business.client.refreshCodeReference(codeReferenceId, writeOptions(business.globals))
      printBusinessResult(context, business.globals, result)
    })
}
