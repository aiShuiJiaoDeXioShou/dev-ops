import { apiClient } from '@/shared/api/client'
import type { TeamRole } from '@/features/identity/model/session'

/**
 * 判断当前角色是否能使用缺陷写入操作。
 * @param role 当前团队角色。
 * @returns 管理员和开发者可写时返回 true。
 */
export function canWriteBugs(role: TeamRole): boolean {
  return role === 'admin' || role === 'developer'
}
/**
 * 判断缺陷的现象、复现、证据和附件清单是否可以编辑。
 * @param status 当前缺陷状态。
 * @returns 待处理或修复中时返回 true。
 */
export function isBugScopeEditable(status: string): boolean {
  return status === 'pending' || status === 'in_fix'
}
export const bugMutations = {
  startFix: apiClient.startBugFix.bind(apiClient),
  submitRegression: apiClient.submitBugRegression.bind(apiClient),
  withdrawRegression: apiClient.withdrawBugRegression.bind(apiClient),
  recordRegression: apiClient.recordBugRegression.bind(apiClient),
  close: apiClient.closeBug.bind(apiClient),
  reopen: apiClient.reopenBug.bind(apiClient),
}
