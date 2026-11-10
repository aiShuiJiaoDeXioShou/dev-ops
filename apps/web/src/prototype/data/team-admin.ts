import type { TeamRole } from './types'

/** 团队成员状态；停用成员保留记录但不再参与团队协作。 */
export type TeamMemberStatus = '正常' | '已停用'

/** 邀请状态；原型不发送邮件，只维护本地邀请记录。 */
export type TeamInvitationStatus = '待接受' | '已过期'

/** 可分配的角色选项，与原型设置中的演示角色一致。 */
export const teamRoleOptions: readonly TeamRole[] = ['管理员', '开发者', '浏览者']

/** 一条团队成员记录。 */
export interface TeamMember {
  id: string
  name: string
  email: string
  role: TeamRole
  status: TeamMemberStatus
  joinedAt: string
  /** 是否为当前演示账号；用于同步顶栏的演示角色。 */
  isCurrentUser: boolean
}

/** 一条团队邀请记录；有效期到期后需要重发。 */
export interface TeamInvitation {
  id: string
  email: string
  role: TeamRole
  status: TeamInvitationStatus
  invitedAt: string
  /** 邀请有效期，形如 `2026-11-17`。 */
  expiresAt: string
}

/** 一个团队的成员与邀请演示工作区；团队名称与图标来自原型上下文。 */
export interface TeamAdminWorkspace {
  createdAt: string
  members: TeamMember[]
  invitations: TeamInvitation[]
}

/** 成员变更校验结果；不允许时给出可直接展示的中文原因。 */
export interface MemberChangeCheck {
  allowed: boolean
  reason: string
}

/** 判断字符串是否为演示团队角色，用于收窄下拉选择结果。 */
export function isTeamRole(value: string): value is TeamRole {
  return teamRoleOptions.some((role) => role === value)
}

/**
 * 创建指定团队的团队管理演示数据。
 * @param teamId 当前演示团队标识。
 * @returns 每个团队独立的成员与邀请数据；未知团队返回仅含演示账号的最小工作区。
 */
export function createTeamAdminWorkspace(teamId: string): TeamAdminWorkspace {
  if (teamId === 'rd') return createRdWorkspace()
  if (teamId === 'product') return createProductWorkspace()
  return {
    createdAt: '2025-01-01',
    members: [currentUserMember('member-me', '管理员', '正常', '2025-01-01')],
    invitations: [],
  }
}

/**
 * 构造当前演示账号的成员记录。
 * @param id 成员标识；role 角色；status 状态；joinedAt 加入时间。
 * @returns 标记为当前账号的成员记录。
 */
function currentUserMember(id: string, role: TeamRole, status: TeamMemberStatus, joinedAt: string): TeamMember {
  return { id, name: '林然', email: 'lin@example.test', role, status, joinedAt, isCurrentUser: true }
}

/**
 * 构造研发团队示例成员与邀请，覆盖多管理员与已停用成员场景。
 * @returns 研发团队的独立演示工作区。
 */
function createRdWorkspace(): TeamAdminWorkspace {
  return {
    createdAt: '2025-03-18',
    members: [
      currentUserMember('member-rd-me', '管理员', '正常', '2025-03-18'),
      {
        id: 'member-rd-chen',
        name: '陈悦',
        email: 'chen@example.test',
        role: '管理员',
        status: '正常',
        joinedAt: '2025-04-02',
        isCurrentUser: false,
      },
      {
        id: 'member-rd-zhou',
        name: '周宁',
        email: 'zhou@example.test',
        role: '开发者',
        status: '正常',
        joinedAt: '2025-06-11',
        isCurrentUser: false,
      },
      {
        id: 'member-rd-xu',
        name: '许嘉',
        email: 'xu@example.test',
        role: '浏览者',
        status: '已停用',
        joinedAt: '2025-08-23',
        isCurrentUser: false,
      },
    ],
    invitations: [
      {
        id: 'invite-rd-lina',
        email: 'li.na@example.test',
        role: '开发者',
        status: '待接受',
        invitedAt: '2026-11-08 10:00',
        expiresAt: '2026-11-15',
      },
      {
        id: 'invite-rd-zhaoyu',
        email: 'zhao.yu@example.test',
        role: '浏览者',
        status: '已过期',
        invitedAt: '2026-10-20 14:30',
        expiresAt: '2026-11-03',
      },
    ],
  }
}

/**
 * 构造产品团队示例成员与邀请，与研发团队数据隔离。
 * @returns 产品团队的独立演示工作区。
 */
function createProductWorkspace(): TeamAdminWorkspace {
  return {
    createdAt: '2025-06-02',
    members: [
      currentUserMember('member-product-me', '管理员', '正常', '2025-06-02'),
      {
        id: 'member-product-zhou',
        name: '周宁',
        email: 'zhou@example.test',
        role: '开发者',
        status: '正常',
        joinedAt: '2025-06-20',
        isCurrentUser: false,
      },
      {
        id: 'member-product-xu',
        name: '许嘉',
        email: 'xu@example.test',
        role: '浏览者',
        status: '正常',
        joinedAt: '2025-09-05',
        isCurrentUser: false,
      },
    ],
    invitations: [
      {
        id: 'invite-product-heqi',
        email: 'he.qi@example.test',
        role: '管理员',
        status: '待接受',
        invitedAt: '2026-11-09 09:30',
        expiresAt: '2026-11-16',
      },
      {
        id: 'invite-product-songyu',
        email: 'song.yu@example.test',
        role: '开发者',
        status: '待接受',
        invitedAt: '2026-11-07 16:10',
        expiresAt: '2026-11-14',
      },
    ],
  }
}

/**
 * 统计当前正常状态的管理员数量。
 * @param members 团队成员列表。
 * @returns 角色为管理员且状态正常的成员数量。
 */
export function countActiveAdmins(members: readonly TeamMember[]): number {
  return members.filter((member) => member.role === '管理员' && member.status === '正常').length
}

/**
 * 校验成员角色与状态变更是否会移除最后一位正常管理员。
 * @param members 当前团队成员列表。
 * @param memberId 目标成员标识。
 * @param next 变更后的角色与状态。
 * @returns 允许变更时 allowed 为 true；否则在 reason 中给出中文拦截原因。
 */
export function checkMemberChange(
  members: readonly TeamMember[],
  memberId: string,
  next: { role: TeamRole; status: TeamMemberStatus },
): MemberChangeCheck {
  const target = members.find((member) => member.id === memberId)
  if (!target) return { allowed: false, reason: '未找到该成员，请刷新后重试。' }
  const removesAdmin =
    target.role === '管理员' && target.status === '正常' && (next.role !== '管理员' || next.status !== '正常')
  if (!removesAdmin) return { allowed: true, reason: '' }
  const otherActiveAdmins = members.filter(
    (member) => member.id !== memberId && member.role === '管理员' && member.status === '正常',
  )
  if (otherActiveAdmins.length === 0) {
    return { allowed: false, reason: '团队必须保留至少一位正常管理员，不能降级或停用最后一位管理员。' }
  }
  return { allowed: true, reason: '' }
}

/**
 * 更新成员的角色或状态。
 * @param workspace 当前团队工作区。
 * @param memberId 目标成员标识。
 * @param patch 需要更新的角色或状态。
 * @returns 新的工作区；成员不存在时原样返回，不修改传入对象。
 */
export function updateMember(
  workspace: TeamAdminWorkspace,
  memberId: string,
  patch: { role?: TeamRole; status?: TeamMemberStatus },
): TeamAdminWorkspace {
  if (!workspace.members.some((member) => member.id === memberId)) return workspace
  return {
    ...workspace,
    members: workspace.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member)),
  }
}

/**
 * 创建一条本地邀请记录；有效期默认为 7 天。
 * @param workspace 当前团队工作区。
 * @param email 被邀请人邮箱。
 * @param role 邀请角色。
 * @returns 新的工作区；新邀请位于列表最前，状态为待接受。
 */
export function inviteMember(workspace: TeamAdminWorkspace, email: string, role: TeamRole): TeamAdminWorkspace {
  const invitation: TeamInvitation = {
    id: `invite-${Date.now()}`,
    email,
    role,
    status: '待接受',
    invitedAt: formatTeamTime(),
    expiresAt: formatDateAfterDays(7),
  }
  return { ...workspace, invitations: [invitation, ...workspace.invitations] }
}

/**
 * 重发邀请：刷新邀请时间并把有效期顺延 7 天。
 * @param workspace 当前团队工作区。
 * @param invitationId 目标邀请标识。
 * @returns 新的工作区；邀请不存在时原样返回，不修改传入对象。
 */
export function resendInvitation(workspace: TeamAdminWorkspace, invitationId: string): TeamAdminWorkspace {
  if (!workspace.invitations.some((invitation) => invitation.id === invitationId)) return workspace
  return {
    ...workspace,
    invitations: workspace.invitations.map((invitation) =>
      invitation.id === invitationId
        ? { ...invitation, status: '待接受', invitedAt: formatTeamTime(), expiresAt: formatDateAfterDays(7) }
        : invitation,
    ),
  }
}

/**
 * 撤销邀请：从本地邀请记录中移除。
 * @param workspace 当前团队工作区。
 * @param invitationId 目标邀请标识。
 * @returns 新的工作区；邀请不存在时原样返回，不修改传入对象。
 */
export function revokeInvitation(workspace: TeamAdminWorkspace, invitationId: string): TeamAdminWorkspace {
  return { ...workspace, invitations: workspace.invitations.filter((invitation) => invitation.id !== invitationId) }
}

/**
 * 生成原型中的本地时间展示文案。
 * @param time 需要展示的时间，默认当前时间。
 * @returns 形如 `2026-11-10 09:24` 的文本。
 */
function formatTeamTime(time: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}

/**
 * 计算若干天后的日期展示，用于邀请有效期。
 * @param days 需要顺延的天数。
 * @returns 形如 `2026-11-17` 的日期文本。
 */
function formatDateAfterDays(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
