import { apiClient } from '@/shared/api/client'
import type { TeamRole } from '@/features/identity/model/session'

/** 需求可写角色。 */
export function canWriteRequirements(role: TeamRole): boolean {
  return role === 'admin' || role === 'developer'
}

/**
 * 判断需求是否可改正文、外部链接、验收标准和附件清单。
 * @param status 当前需求状态。
 * @returns 待处理或开发中时返回 true。
 */
export function isRequirementScopeEditable(status: string): boolean {
  return status === 'pending' || status === 'in_development'
}

export const requirementMutations = {
  create: apiClient.createRequirement.bind(apiClient),
  update: apiClient.updateRequirement.bind(apiClient),
  startDevelopment: apiClient.startRequirementDevelopment.bind(apiClient),
  submitTest: apiClient.submitRequirementTest.bind(apiClient),
  startTest: apiClient.startRequirementTest.bind(apiClient),
  withdrawTest: apiClient.withdrawRequirementTest.bind(apiClient),
  returnToDevelopment: apiClient.returnRequirementToDevelopment.bind(apiClient),
  passTest: apiClient.passRequirementTest.bind(apiClient),
  reopenDevelopment: apiClient.reopenRequirementDevelopment.bind(apiClient),
  cancel: apiClient.cancelRequirement.bind(apiClient),
  restore: apiClient.restoreRequirement.bind(apiClient),
}
