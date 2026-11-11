import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'

/** 变更计划状态；与 `change_plan.status` 的 CHECK 白名单一致。 */
export type ChangePlanStatus = 'pending' | 'approved' | 'executing' | 'verifying' | 'completed' | 'failed' | 'cancelled'

/** 执行尝试状态；与 `change_execution.status` 的 CHECK 白名单一致。 */
export type ChangeExecutionStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'timed_out' | 'unverified'

/** 计划状态的合法迁移；失败只能通过重试回到已批准。 */
const PLAN_TRANSITIONS: Readonly<Record<ChangePlanStatus, readonly ChangePlanStatus[]>> = {
  pending: ['approved', 'cancelled'],
  approved: ['executing', 'cancelled'],
  executing: ['verifying', 'failed', 'cancelled'],
  verifying: ['completed', 'failed'],
  completed: [],
  failed: ['approved'],
  cancelled: [],
}

/** 执行尝试的合法迁移；终态不可再变化。 */
const EXECUTION_TRANSITIONS: Readonly<Record<ChangeExecutionStatus, readonly ChangeExecutionStatus[]>> = {
  queued: ['running', 'failed'],
  running: ['succeeded', 'failed', 'interrupted', 'timed_out'],
  succeeded: ['unverified'],
  failed: [],
  interrupted: [],
  timed_out: [],
  unverified: [],
}

/**
 * 判断计划状态迁移是否合法。
 * @param from 当前状态。
 * @param to 目标状态。
 * @returns 允许迁移时返回 true。
 */
export function canTransitionPlan(from: ChangePlanStatus, to: ChangePlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to)
}

/**
 * 要求计划状态迁移合法。
 * @throws 迁移不合法时抛出 INVALID_TRANSITION。
 */
export function assertPlanTransition(from: ChangePlanStatus, to: ChangePlanStatus): void {
  if (!canTransitionPlan(from, to)) {
    throw new ApiError(ERROR_CODES.INVALID_TRANSITION, `变更计划不能从 ${from} 迁移到 ${to}`)
  }
}

/**
 * 判断执行尝试状态迁移是否合法。
 * @param from 当前状态。
 * @param to 目标状态。
 * @returns 允许迁移时返回 true。
 */
export function canTransitionExecution(from: ChangeExecutionStatus, to: ChangeExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to)
}

/**
 * 要求执行尝试状态迁移合法。
 * @throws 迁移不合法时抛出 INVALID_TRANSITION。
 */
export function assertExecutionTransition(from: ChangeExecutionStatus, to: ChangeExecutionStatus): void {
  if (!canTransitionExecution(from, to)) {
    throw new ApiError(ERROR_CODES.INVALID_TRANSITION, `执行尝试不能从 ${from} 迁移到 ${to}`)
  }
}

/**
 * 判断计划是否处于可编辑状态；只有待确认可编辑。
 * @param status 计划状态。
 * @returns 可编辑时返回 true。
 */
export function isPlanEditable(status: ChangePlanStatus): boolean {
  return status === 'pending'
}

/**
 * 判断计划是否占用目标的活动位；与部分唯一索引条件保持一致。
 * @param status 计划状态。
 * @returns approved/executing/verifying 返回 true。
 */
export function isPlanActive(status: ChangePlanStatus): boolean {
  return status === 'approved' || status === 'executing' || status === 'verifying'
}

/**
 * 判断执行尝试是否仍在进行。
 * @param status 执行状态。
 * @returns queued/running 返回 true。
 */
export function isExecutionActive(status: ChangeExecutionStatus): boolean {
  return status === 'queued' || status === 'running'
}
