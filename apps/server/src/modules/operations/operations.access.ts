import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import { findProjectById } from '../projects/projects.repository.ts'

/** 变更计划权限判断所需的最小行字段。 */
export interface PlanAccessRow {
  team_id: string
  project_id: string
  created_by_user_id: string
}

/** 计划操作者上下文。 */
export interface PlanActorContext {
  role: TeamRole
  isProjectOwner: boolean
}

/**
 * 要求用户是计划所属团队成员，返回角色与项目负责人标记。
 * @param db 数据库连接。
 * @param user 当前用户。
 * @param plan 计划行（至少含 team_id/project_id）。
 * @returns 角色上下文。
 * @throws 非团队成员时抛出 FORBIDDEN。
 */
export async function requirePlanMemberContext(
  db: Database,
  user: SessionUser,
  plan: Pick<PlanAccessRow, 'team_id' | 'project_id'>,
): Promise<PlanActorContext> {
  const member = await requireTeamMember(db, user.id, plan.team_id)
  const projectRow = await findProjectById(db, plan.project_id)
  return {
    role: member.role as TeamRole,
    isProjectOwner: projectRow?.owner_user_id === user.id,
  }
}

/**
 * 判断角色上下文是否可管理计划（放行、执行、验证、取消他人计划）。
 * @param context 计划操作者上下文。
 * @returns 团队管理员或项目负责人返回 true。
 */
export function canManagePlan(context: PlanActorContext): boolean {
  return context.role === 'admin' || context.isProjectOwner
}

/**
 * 要求用户可管理计划；浏览者、普通开发者一律拒绝。
 * @throws 无权限时抛出 FORBIDDEN。
 */
export async function requirePlanManager(
  db: Database,
  user: SessionUser,
  plan: PlanAccessRow,
): Promise<PlanActorContext> {
  const context = await requirePlanMemberContext(db, user, plan)
  if (!canManagePlan(context)) throw new ApiError(ERROR_CODES.FORBIDDEN, '需要团队管理员或项目负责人权限')
  return context
}

/**
 * 要求用户可编辑计划：仅发起人、团队管理员或项目负责人在待确认状态可编辑。
 * @throws 无权限时抛出 FORBIDDEN；状态不允许时由调用方检查。
 */
export async function requirePlanEditor(
  db: Database,
  user: SessionUser,
  plan: PlanAccessRow,
): Promise<PlanActorContext> {
  const context = await requirePlanMemberContext(db, user, plan)
  if (plan.created_by_user_id !== user.id && !canManagePlan(context)) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '只有发起人、团队管理员或项目负责人可以修改计划')
  }
  return context
}

/**
 * 禁止发起人放行自己的计划，避免自我授权。
 * @throws 发起人与放行人一致时抛出 SELF_APPROVAL_FORBIDDEN。
 */
export function assertNotSelfApproval(actorUserId: string, plan: PlanAccessRow): void {
  if (actorUserId === plan.created_by_user_id) {
    throw new ApiError(ERROR_CODES.SELF_APPROVAL_FORBIDDEN, '发起人不能放行自己的变更计划')
  }
}

/**
 * 要求用户可取消计划：发起人、团队管理员或项目负责人。
 * @throws 无权限时抛出 FORBIDDEN。
 */
export async function requirePlanCanceller(
  db: Database,
  user: SessionUser,
  plan: PlanAccessRow,
): Promise<PlanActorContext> {
  return requirePlanEditor(db, user, plan)
}
