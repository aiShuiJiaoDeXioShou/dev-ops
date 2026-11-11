import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ApiBody } from '@dev-ops/api-client'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { Command } from 'commander'
import { businessContext, printBusinessResult, readContent } from '../lib/command.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'

const CAPABILITIES = ['code_change', 'create_pull_request', 'create_issue', 'add_comment'] as const

type CreateCodeChangeBody = ApiBody<'/api/v1/projects/{projectId}/tools/code-changes', 'post'>
type CreatePullRequestBody = ApiBody<'/api/v1/tools/code-changes/{codeChangeId}/pull-requests', 'post'>
type CreateRemoteIssueBody = ApiBody<'/api/v1/projects/{projectId}/tools/remote-issues', 'post'>
type AddCommentBody = ApiBody<'/api/v1/projects/{projectId}/tools/comments', 'post'>

function requireCapability(value: string | undefined): (typeof CAPABILITIES)[number] {
  if (value === undefined) throw new CliError('缺少 --capability', 2, { code: 'MISSING_OPTION' })
  if (!(CAPABILITIES as readonly string[]).includes(value)) {
    throw new CliError(`能力取值不合法，可选：${CAPABILITIES.join('|')}`, 2, { code: 'INVALID_OPTION' })
  }
  return value as (typeof CAPABILITIES)[number]
}

/**
 * 读取补丁文件并计算 SHA-256；`-` 从标准输入读取。
 * @returns 补丁正文与摘要。
 */
async function readPatch(path: string, context: CliContext): Promise<{ patch: string; sha256: string }> {
  let patch: string
  try {
    patch = path === '-' ? await (context.readStdin ?? (async () => ''))() : await readFile(path, 'utf8')
  } catch {
    throw new CliError(`无法读取补丁文件：${path}`, 2, { code: 'PATCH_READ_FAILED' })
  }
  if (patch.trim().length === 0) throw new CliError('补丁不能为空', 2, { code: 'PATCH_EMPTY' })
  return { patch, sha256: createHash('sha256').update(patch, 'utf8').digest('hex') }
}

/**
 * 注册项目写能力与远端写命令组。
 * @param program 根命令。
 * @param context CLI 上下文。
 */
export function registerToolCommands(program: Command, context: CliContext): void {
  const tool = program.command('tool').description('项目写能力：代码修改、PR、Issue、评论与授权')

  tool
    .command('capabilities')
    .description('查询当前用户的项目写能力')
    .requiredOption('--project <projectId>', '项目标识')
    .action(async (options: { project: string }, command: Command) => {
      const business = await businessContext(command, context)
      printBusinessResult(context, business.globals, await business.client.getToolCapabilities(options.project))
    })

  const grants = tool.command('grants').description('管理项目写能力授权')
  grants
    .command('list')
    .description('列出项目写能力授权')
    .requiredOption('--project <projectId>', '项目标识')
    .action(async (options: { project: string }, command: Command) => {
      const business = await businessContext(command, context)
      printBusinessResult(context, business.globals, await business.client.listToolGrants(options.project))
    })
  grants
    .command('add')
    .description('授予项目写能力')
    .requiredOption('--project <projectId>', '项目标识')
    .requiredOption('--user <userId>', '被授权成员标识')
    .requiredOption('--capability <capability>', `能力：${CAPABILITIES.join('|')}`)
    .action(async (options: { project: string; user: string; capability: string }, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.grantToolCapability(options.project, {
        userId: options.user,
        capability: requireCapability(options.capability),
      })
      printBusinessResult(context, business.globals, result)
    })
  grants
    .command('revoke')
    .description('撤销项目写能力授权')
    .requiredOption('--project <projectId>', '项目标识')
    .requiredOption('--grant <grantId>', '授权标识')
    .option('--reason <reason>', '撤销原因')
    .action(async (options: { project: string; grant: string; reason?: string }, command: Command) => {
      const business = await businessContext(command, context)
      await confirmDangerous({
        yes: business.globals.yes === true,
        json: business.globals.json,
        message: `确认撤销授权 ${options.grant}？撤销后新的写调用将被拒绝。`,
      })
      const result = await business.client.revokeToolGrant(options.project, options.grant, {
        reason: options.reason ?? null,
      })
      printBusinessResult(context, business.globals, result)
    })

  const codeChange = tool.command('code-change').description('受控代码修改')
  codeChange
    .command('create')
    .description('在受控执行环境发起代码修改')
    .requiredOption('--project <projectId>', '项目标识')
    .requiredOption('--repository <repositoryId>', '仓库标识')
    .requiredOption('--base <ref>', '基线分支或标签')
    .requiredOption('--branch <name>', '工作分支')
    .requiredOption('--message <message>', '提交信息')
    .requiredOption('--patch-file <path>', '补丁文件；使用 - 从标准输入读取')
    .requiredOption('--validation-workflow <path>', '仓库内校验工作流路径')
    .option('--secret-environment <environment>', '运行 secret 环境：development|test|production')
    .action(
      async (
        options: {
          project: string
          repository: string
          base: string
          branch: string
          message: string
          patchFile: string
          validationWorkflow: string
          secretEnvironment?: string
        },
        command: Command,
      ) => {
        const business = await businessContext(command, context)
        const { patch, sha256 } = await readPatch(options.patchFile, context)
        const environment = options.secretEnvironment
        if (environment !== undefined && !['development', 'test', 'production'].includes(environment)) {
          throw new CliError('--secret-environment 取值不合法', 2, { code: 'INVALID_OPTION' })
        }
        const body: CreateCodeChangeBody = {
          repositoryId: options.repository,
          baseRef: options.base,
          branchName: options.branch,
          commitMessage: options.message,
          patch,
          patchSha256: sha256,
          validationWorkflowPath: options.validationWorkflow,
          ...(environment ? { secretEnvironment: environment as 'development' | 'test' | 'production' } : {}),
        }
        const result = await business.client.createCodeChange(options.project, body, {
          idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey(),
        })
        printBusinessResult(context, business.globals, result)
      },
    )
  codeChange
    .command('list')
    .description('列出项目代码变更')
    .requiredOption('--project <projectId>', '项目标识')
    .action(async (options: { project: string }, command: Command) => {
      const business = await businessContext(command, context)
      printBusinessResult(context, business.globals, await business.client.listCodeChanges(options.project), true)
    })
  codeChange
    .command('show')
    .description('查看代码变更详情')
    .argument('<codeChangeId>', '代码变更标识')
    .action(async (codeChangeId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      printBusinessResult(context, business.globals, await business.client.getCodeChange(codeChangeId))
    })
  codeChange
    .command('diff')
    .description('查看代码差异')
    .argument('<codeChangeId>', '代码变更标识')
    .action(async (codeChangeId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      printBusinessResult(context, business.globals, await business.client.getCodeChangeDiff(codeChangeId))
    })
  codeChange
    .command('cancel')
    .description('取消排队或运行中的代码变更')
    .argument('<codeChangeId>', '代码变更标识')
    .option('--reason <reason>', '取消原因')
    .action(async (codeChangeId: string, options: { reason?: string }, command: Command) => {
      const business = await businessContext(command, context)
      await confirmDangerous({
        yes: business.globals.yes === true,
        json: business.globals.json,
        message: `确认取消代码变更 ${codeChangeId}？`,
      })
      const result = await business.client.cancelCodeChange(codeChangeId, { reason: options.reason ?? null })
      printBusinessResult(context, business.globals, result)
    })

  tool
    .command('pr')
    .description('为已成功的代码变更创建远端 PR/MR')
    .argument('<codeChangeId>', '代码变更标识')
    .requiredOption('--title <title>', 'PR 标题')
    .option('--body-file <path>', 'PR 正文文件；使用 - 从标准输入读取')
    .option('--target-branch <branch>', '目标分支，默认基线分支')
    .action(
      async (
        codeChangeId: string,
        options: { title: string; bodyFile?: string; targetBranch?: string },
        command: Command,
      ) => {
        const business = await businessContext(command, context)
        const bodyText = options.bodyFile ? await readContent(options.bodyFile, context) : ''
        const body: CreatePullRequestBody = {
          title: options.title,
          body: bodyText,
          ...(options.targetBranch ? { targetBranch: options.targetBranch } : {}),
        }
        const result = await business.client.createCodeChangePullRequest(codeChangeId, body, {
          idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey(),
        })
        printBusinessResult(context, business.globals, result)
      },
    )

  tool
    .command('issue')
    .description('创建远端 Issue 并关联本地 Bug')
    .requiredOption('--project <projectId>', '项目标识')
    .requiredOption('--bug <bugId>', '本地 Bug 标识')
    .requiredOption('--repository <repositoryId>', '仓库标识')
    .requiredOption('--title <title>', 'Issue 标题')
    .option('--body-file <path>', '正文文件；使用 - 从标准输入读取')
    .action(
      async (
        options: { project: string; bug: string; repository: string; title: string; bodyFile?: string },
        command: Command,
      ) => {
        const business = await businessContext(command, context)
        const bodyText = options.bodyFile ? await readContent(options.bodyFile, context) : ''
        const body: CreateRemoteIssueBody = {
          repositoryId: options.repository,
          bugId: options.bug,
          title: options.title,
          body: bodyText,
        }
        const result = await business.client.createRemoteIssue(options.project, body, {
          idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey(),
        })
        printBusinessResult(context, business.globals, result)
      },
    )

  tool
    .command('comment')
    .description('添加本地事项或远端记录评论')
    .requiredOption('--project <projectId>', '项目标识')
    .option('--requirement <requirementId>', '本地需求标识')
    .option('--bug <bugId>', '本地 Bug 标识')
    .option('--remote-issue <number>', '远端 Issue 编号', Number)
    .option('--remote-pr <number>', '远端 PR 编号', Number)
    .option('--repository <repositoryId>', '远端评论所需仓库标识')
    .requiredOption('--body-file <path>', '评论正文文件；使用 - 从标准输入读取')
    .action(
      async (
        options: {
          project: string
          requirement?: string
          bug?: string
          remoteIssue?: number
          remotePr?: number
          repository?: string
          bodyFile: string
        },
        command: Command,
      ) => {
        const business = await businessContext(command, context)
        const bodyText = await readContent(options.bodyFile, context)
        if (bodyText.trim() === '') {
          throw new CliError('评论正文不能为空', 2, { code: 'EMPTY_COMMENT' })
        }
        if ((options.remoteIssue !== undefined || options.remotePr !== undefined) && !options.repository) {
          throw new CliError('远端评论需要 --repository <repositoryId>', 2, { code: 'MISSING_REPOSITORY' })
        }
        const targets = [options.requirement, options.bug, options.remoteIssue, options.remotePr].filter(
          (value) => value !== undefined,
        )
        if (targets.length !== 1) {
          throw new CliError('必须且只能指定一个评论目标', 2, { code: 'INVALID_TARGET' })
        }
        const targetType: AddCommentBody['targetType'] = options.requirement
          ? 'requirement'
          : options.bug
            ? 'bug'
            : options.remoteIssue !== undefined
              ? 'remote_issue'
              : 'remote_pull_request'
        const body: AddCommentBody = {
          targetType,
          body: bodyText,
          ...(options.requirement ? { targetId: options.requirement } : {}),
          ...(options.bug ? { targetId: options.bug } : {}),
          ...(options.remoteIssue !== undefined
            ? { repositoryId: options.repository, remoteNumber: options.remoteIssue }
            : {}),
          ...(options.remotePr !== undefined
            ? { repositoryId: options.repository, remoteNumber: options.remotePr }
            : {}),
        }
        const result = await business.client.addToolComment(options.project, body, {
          idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey(),
        })
        printBusinessResult(context, business.globals, result)
      },
    )
}
