import { apiClient } from '@/shared/api/client'
import type { TeamRole } from '@/features/identity/public'

/** 需求可写角色。 */
export function canWriteRequirements(role: TeamRole): boolean {
  return role === 'admin' || role === 'developer'
}

/** 不需要提测的有效状态。 */
export function isEditable(status: string): boolean {
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
