import { createIdempotencyKey, type ApiBody } from '@dev-ops/api-client'
import type { Command } from 'commander'
import { businessContext, globalsOf, printBusinessResult, resolveTeamId } from '../lib/command.ts'
import type { GlobalOptions } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'

/** 团队成员角色，与平台契约一致。 */
type MemberRole = 'admin' | 'developer' | 'viewer'

/** 团队成员状态；disabled 为危险操作。 */
type MemberStatus = 'active' | 'disabled'

/** 团队邀请状态。 */
type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

interface TeamCreateOptions {
  name?: string
  adminEmail?: string
}

interface MemberUpdateOptions {
  role?: string
  status?: string
}

interface InvitationListOptions {
  status?: string
}

interface InvitationCreateOptions {
  email?: string
  role?: string
}

/** 校验成员角色取值。 */
function parseMemberRole(value: string): MemberRole {
  switch (value) {
    case 'admin':
    case 'developer':
    case 'viewer':
      return value
    default:
      throw new CliError('--role 必须是 admin、developer 或 viewer', 2, { code: 'INVALID_ROLE' })
  }
}

/** 校验成员状态取值。 */
function parseMemberStatus(value: string): MemberStatus {
  switch (value) {
    case 'active':
    case 'disabled':
      return value
    default:
      throw new CliError('--status 必须是 active 或 disabled', 2, { code: 'INVALID_STATUS' })
  }
}

/** 校验邀请状态筛选值。 */
function parseInvitationStatus(value: string): InvitationStatus {
  switch (value) {
    case 'pending':
    case 'accepted':
    case 'expired':
    case 'revoked':
      return value
    default:
      throw new CliError('--status 必须是 pending、accepted、expired 或 revoked', 2, { code: 'INVALID_STATUS' })
  }
}

/** 读取必填文本选项；空值按参数错误处理。 */
function requireText(value: string | undefined, message: string): string {
  const text = value?.trim()
  if (text === undefined || text === '') throw new CliError(message, 2, { code: 'MISSING_OPTION' })
  return text
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
 * 注册 `devops team` 命令组：团队创建、成员与邀请管理。
 * @param program 根命令，用于挂载命令组。
 * @param context CLI 执行上下文，提供环境与输出通道。
 * @returns 无返回值；命令仅注册动作，解析时再解析认证配置并发起请求。
 * @remarks 列表结果按平台列表结构归一化；停用成员与撤销邀请属危险操作，需 `--yes`。
 */
export function registerTeamCommands(program: Command, context: CliContext): void {
  const team = program.command('team').description('管理团队、成员与邀请')

  team
    .command('list')
    .description('列出当前账号加入的团队')
    .action(async (_options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.listMyTeams()
      printBusinessResult(context, business.globals, result, true)
    })

  team
    .command('create')
    .description('由平台 root 创建团队并邀请管理员')
    .option('--name <name>', '团队名称，必填')
    .option('--admin-email <email>', '管理员邮箱，必填')
    .action(async (_options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<TeamCreateOptions>()
      const name = requireText(options.name, 'team create 需要 --name')
      const adminEmail = requireText(options.adminEmail, 'team create 需要 --admin-email')
      const business = await businessContext(command, context)
      const body: ApiBody<'/api/v1/platform/teams', 'post'> = { name, adminEmail }
      const result = await business.client.createTeam(body, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })

  const member = team.command('member').description('管理团队成员')

  member
    .command('list')
    .description('列出团队成员（团队任一正常成员可读）')
    .action(async (_options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const result = await business.client.listTeamMembers(teamId)
      printBusinessResult(context, business.globals, result, true)
    })

  member
    .command('update')
    .argument('<userId>', '成员用户标识')
    .description('调整成员角色或停用/恢复成员（管理员）；停用需 --yes')
    .option('--role <role>', '新的角色：admin、developer 或 viewer')
    .option('--status <status>', '新的状态：active 或 disabled')
    .action(async (userId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<MemberUpdateOptions>()
      const role = options.role === undefined ? undefined : parseMemberRole(options.role)
      const status = options.status === undefined ? undefined : parseMemberStatus(options.status)
      if (role === undefined && status === undefined) {
        throw new CliError('team member update 至少需要 --role 或 --status', 2, { code: 'MISSING_OPTION' })
      }
      if (status === 'disabled') await requireConfirmation(globals, `确认停用成员 ${userId}？`)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const body: ApiBody<'/api/v1/teams/{teamId}/members/{userId}/update', 'post'> = {
        ...(role === undefined ? {} : { role }),
        ...(status === undefined ? {} : { status }),
      }
      const result = await business.client.updateTeamMember(teamId, userId, body, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })

  const invitation = team.command('invitation').description('管理团队邀请')

  invitation
    .command('list')
    .description('列出团队邀请（管理员），支持按状态筛选')
    .option('--status <status>', '按状态筛选：pending、accepted、expired 或 revoked')
    .action(async (_options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<InvitationListOptions>()
      const status = options.status === undefined ? undefined : parseInvitationStatus(options.status)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const result = await business.client.listTeamInvitations(teamId, status === undefined ? undefined : { status })
      printBusinessResult(context, globals, result, true)
    })

  invitation
    .command('create')
    .description('邀请成员加入团队（管理员）')
    .option('--email <email>', '被邀请人邮箱，必填')
    .option('--role <role>', '邀请角色：admin、developer 或 viewer，必填')
    .action(async (_options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const options = command.opts<InvitationCreateOptions>()
      const email = requireText(options.email, 'team invitation create 需要 --email')
      const role = parseMemberRole(requireText(options.role, 'team invitation create 需要 --role'))
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const body: ApiBody<'/api/v1/teams/{teamId}/invitations', 'post'> = { email, role }
      const result = await business.client.inviteTeamMember(teamId, body, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })

  invitation
    .command('resend')
    .argument('<invitationId>', '邀请标识')
    .description('重发团队邀请（管理员）')
    .action(async (invitationId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const result = await business.client.resendInvitation(teamId, invitationId, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })

  invitation
    .command('revoke')
    .argument('<invitationId>', '邀请标识')
    .description('撤销团队邀请（管理员）；危险操作，需 --yes')
    .action(async (invitationId: string, _options: unknown, command: Command) => {
      const globals = globalsOf(command)
      await requireConfirmation(globals, `确认撤销邀请 ${invitationId}？`)
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const result = await business.client.revokeInvitation(teamId, invitationId, writeOptions(globals))
      printBusinessResult(context, globals, result)
    })
}
