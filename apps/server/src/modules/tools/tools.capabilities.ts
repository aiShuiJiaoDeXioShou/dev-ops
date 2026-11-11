import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { loadUserRefs, userRefOf, type UserRef } from '../identity/identity.display.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import { findProjectById } from '../projects/projects.repository.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { projectCapabilityGrant } from './tools.tables.ts'

/** 项目写能力标识；新增能力必须同步数据库 CHECK、授权入口与调用方。 */
export const TOOL_CAPABILITIES = ['code_change', 'create_pull_request', 'create_issue', 'add_comment'] as const
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number]

/** 写能力调用渠道。 */
export type ToolChannel = 'web' | 'cli'

/** 授权记录视图；用户与授权人只展示标识与姓名。 */
export interface CapabilityGrantView {
  id: string
  user: UserRef
  capability: ToolCapability
  grantedBy: UserRef
  grantedAt: string
  revokedAt: string | null
}

/** 当前用户在某项目的写能力状态。 */
export interface ToolCapabilityState {
  capability: ToolCapability
  granted: boolean
}

/** 项目权限上下文；角色用于区分管理员、开发者与浏览者。 */
export interface ProjectRoleContext {
  teamId: string
  role: TeamRole
  ownerUserId: string
}

/**
 * 判断字符串是否为受支持的项目写能力。
 * @param value 待判断值。
 * @returns 是受支持能力时返回 true。
 */
export function isToolCapability(value: string): value is ToolCapability {
  return (TOOL_CAPABILITIES as readonly string[]).includes(value)
}

/**
 * 校验并收窄项目写能力。
 * @param value 输入值。
 * @returns 受支持的能力标识。
 * @throws 能力不受支持时抛出 VALIDATION_ERROR。
 */
export function requireToolCapability(value: string): ToolCapability {
  if (!isToolCapability(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '写能力标识不受支持')
  return value
}

/**
 * 读取用户对项目的角色上下文；跨团队或非成员一律拒绝。
 * @param db 数据库连接。
 * @param user 当前用户。
 * @param projectId 项目标识。
 * @returns 团队、角色与项目负责人标识。
 * @throws 项目不存在或用户不是团队成员时抛出 NOT_FOUND/FORBIDDEN。
 */
export async function getProjectRoleContext(
  db: Database,
  user: SessionUser,
  projectId: string,
): Promise<ProjectRoleContext> {
  const context = await getProjectContext(db, projectId)
  if (!context) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
  const member = await requireTeamMember(db, user.id, context.teamId)
  const projectRow = await findProjectById(db, projectId)
  if (!projectRow) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
  return { teamId: context.teamId, role: member.role as TeamRole, ownerUserId: projectRow.owner_user_id }
}

/**
 * 判断用户能否管理项目写能力授权（团队管理员或项目负责人）。
 * @param db 数据库连接。
 * @param user 当前用户。
 * @param projectId 项目标识。
 * @returns 可管理时返回 true；非成员或项目不存在返回 false。
 */
export async function canManageCapabilityGrants(db: Database, user: SessionUser, projectId: string): Promise<boolean> {
  const context = await getProjectContext(db, projectId)
  if (!context) return false
  try {
    const member = await requireTeamMember(db, user.id, context.teamId)
    if (member.role === 'admin') return true
    const projectRow = await findProjectById(db, projectId)
    return projectRow?.owner_user_id === user.id
  } catch {
    return false
  }
}

/**
 * 要求用户具备管理项目写能力授权的权限。
 * @throws 无权限时抛出 FORBIDDEN。
 */
export async function requireCapabilityGrantManager(
  db: Database,
  user: SessionUser,
  projectId: string,
): Promise<ProjectRoleContext> {
  const context = await getProjectRoleContext(db, user, projectId)
  if (context.role === 'admin' || context.ownerUserId === user.id) return context
  throw new ApiError(ERROR_CODES.FORBIDDEN, '需要团队管理员或项目负责人权限')
}

/**
 * 查询指定有效授权。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param userId 用户标识。
 * @param capability 能力标识。
 * @returns 有效授权行；未授权时返回 undefined。
 */
export async function findActiveGrant(db: Database, projectId: string, userId: string, capability: ToolCapability) {
  const [row] = await db
    .select()
    .from(projectCapabilityGrant)
    .where(
      and(
        eq(projectCapabilityGrant.project_id, projectId),
        eq(projectCapabilityGrant.grantee_user_id, userId),
        eq(projectCapabilityGrant.capability, capability),
        isNull(projectCapabilityGrant.revoked_at),
      ),
    )
    .limit(1)
  return row
}

/**
 * 读取用户在某项目四类写能力的授权状态。
 * @returns 固定顺序的能力状态数组；不返回授权人信息。
 */
export async function listCapabilityState(
  db: Database,
  user: SessionUser,
  projectId: string,
): Promise<ToolCapabilityState[]> {
  await getProjectRoleContext(db, user, projectId)
  const rows = await db
    .select({
      capability: projectCapabilityGrant.capability,
      granted: projectCapabilityGrant.id,
    })
    .from(projectCapabilityGrant)
    .where(
      and(
        eq(projectCapabilityGrant.project_id, projectId),
        eq(projectCapabilityGrant.grantee_user_id, user.id),
        isNull(projectCapabilityGrant.revoked_at),
      ),
    )
  const granted = new Set(rows.map((row) => row.capability))
  return TOOL_CAPABILITIES.map((capability) => ({ capability, granted: granted.has(capability) }))
}

/**
 * 要求用户具备具体写能力；项目成员身份与角色不能替代能力授权。
 * @param db 数据库连接。
 * @param user 当前用户。
 * @param projectId 项目标识。
 * @param capability 能力标识。
 * @returns 项目团队标识。
 * @throws 非成员、浏览者或未授权时抛出 FORBIDDEN/TOOL_CAPABILITY_NOT_GRANTED。
 */
export async function requireToolCapabilityGrant(
  db: Database,
  user: SessionUser,
  projectId: string,
  capability: ToolCapability,
): Promise<string> {
  const context = await getProjectRoleContext(db, user, projectId)
  if (context.role === 'viewer') throw new ApiError(ERROR_CODES.FORBIDDEN, '浏览者不能执行写操作')
  const grant = await findActiveGrant(db, projectId, user.id, capability)
  if (!grant) throw new ApiError(ERROR_CODES.TOOL_CAPABILITY_NOT_GRANTED, '缺少项目写能力授权')
  return context.teamId
}

/**
 * 授予项目写能力。
 * @param db 数据库连接。
 * @param user 授权人。
 * @param projectId 项目标识。
 * @param input 被授权成员与能力。
 * @returns 新建授权视图。
 * @throws 被授权人不是正常成员、是浏览者或重复授权时抛出业务错误。
 */
export async function grantToolCapability(
  db: Database,
  user: SessionUser,
  projectId: string,
  input: { userId: string; capability: string },
): Promise<CapabilityGrantView> {
  const context = await requireCapabilityGrantManager(db, user, projectId)
  const capability = requireToolCapability(input.capability)
  const grantee = await requireTeamMember(db, input.userId, context.teamId)
  if (grantee.role === 'viewer') throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '不能向浏览者授予写能力')
  const id = randomUUID()
  try {
    const [row] = await db
      .insert(projectCapabilityGrant)
      .values({
        id,
        team_id: context.teamId,
        project_id: projectId,
        grantee_user_id: input.userId,
        capability,
        granted_by_user_id: user.id,
      })
      .returning()
    if (!row) throw new Error('写能力授权写入失败')
    const refs = await loadUserRefs(db, [row.grantee_user_id, row.granted_by_user_id])
    return toCapabilityGrantView(row, refs)
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '该成员已获得此能力')
    throw error
  }
}

/**
 * 撤销项目写能力授权；只写撤销时间，保留历史。
 * @throws 授权不存在或已撤销时抛出 NOT_FOUND/INVALID_TRANSITION。
 */
export async function revokeToolCapability(
  db: Database,
  user: SessionUser,
  projectId: string,
  grantId: string,
  reason?: string,
): Promise<void> {
  await requireCapabilityGrantManager(db, user, projectId)
  const now = new Date()
  const [row] = await db
    .update(projectCapabilityGrant)
    .set({
      revoked_at: now,
      revoked_by_user_id: user.id,
      updated_at: now,
    })
    .where(
      and(
        eq(projectCapabilityGrant.id, grantId),
        eq(projectCapabilityGrant.project_id, projectId),
        isNull(projectCapabilityGrant.revoked_at),
      ),
    )
    .returning({ id: projectCapabilityGrant.id })
  if (!row) throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '授权不存在或已撤销')
  void reason
}

/**
 * 列出项目写能力授权，按创建时间倒序。
 * @param db 数据库连接。
 * @param user 当前用户（须为项目成员）。
 * @param projectId 项目标识。
 * @returns 授权视图数组。
 */
export async function listToolCapabilityGrants(
  db: Database,
  user: SessionUser,
  projectId: string,
): Promise<CapabilityGrantView[]> {
  await getProjectRoleContext(db, user, projectId)
  const rows = await db
    .select()
    .from(projectCapabilityGrant)
    .where(eq(projectCapabilityGrant.project_id, projectId))
    .orderBy(desc(projectCapabilityGrant.created_at), projectCapabilityGrant.id)
  const refs = await loadUserRefs(
    db,
    rows.flatMap((row) => [row.grantee_user_id, row.granted_by_user_id]),
  )
  return rows.map((row) => toCapabilityGrantView(row, refs))
}

interface GrantRow {
  id: string
  grantee_user_id: string
  capability: string
  granted_by_user_id: string
  granted_at?: Date
  created_at: Date
  revoked_at: Date | null
}

/** 授权行转视图；调用方负责预先加载用户展示引用。 */
function toCapabilityGrantView(row: GrantRow, refs: Awaited<ReturnType<typeof loadUserRefs>>): CapabilityGrantView {
  return {
    id: row.id,
    user: userRefOf(row.grantee_user_id, refs) ?? { userId: row.grantee_user_id, name: '未知用户' },
    capability: requireToolCapability(row.capability),
    grantedBy: userRefOf(row.granted_by_user_id, refs) ?? { userId: row.granted_by_user_id, name: '未知用户' },
    grantedAt: (row.granted_at ?? row.created_at).toISOString(),
    revokedAt: row.revoked_at === null ? null : row.revoked_at.toISOString(),
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = Reflect.get(error, 'code')
  return code === '23505'
}
