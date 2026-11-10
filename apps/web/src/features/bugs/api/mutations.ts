import { apiClient } from '@/shared/api/client'
import type { TeamRole } from '@/features/identity/public'

export function canWriteBugs(role: TeamRole): boolean {
  return role === 'admin' || role === 'developer'
}
export function isEditableBug(status: string): boolean {
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
