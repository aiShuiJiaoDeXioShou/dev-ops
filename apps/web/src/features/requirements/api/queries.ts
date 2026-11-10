import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export type RequirementListStatus = 'pending' | 'in_development' | 'submitted' | 'in_testing' | 'passed' | 'cancelled'
export interface RequirementListFilters {
  search?: string
  status?: RequirementListStatus
  ownerId?: string
  page?: number
  pageSize?: number
}

/** 项目需求列表。 */
export function requirementListQueryOptions(projectId: string, filters: RequirementListFilters) {
  return queryOptions({
    queryKey: ['requirements', 'list', projectId, filters],
    queryFn: ({ signal }) => apiClient.listRequirements(projectId, filters, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 需求详情。 */
export function requirementQueryOptions(requirementId: string) {
  return queryOptions({
    queryKey: ['requirements', 'detail', requirementId],
    queryFn: ({ signal }) => apiClient.getRequirement(requirementId, { signal }),
    enabled: Boolean(requirementId),
  })
}

/** 测试通过资格与阻碍项。 */
export function eligibilityQueryOptions(requirementId: string) {
  return queryOptions({
    queryKey: ['requirements', 'eligibility', requirementId],
    queryFn: ({ signal }) => apiClient.getRequirementTestPassEligibility(requirementId, { signal }),
    enabled: Boolean(requirementId),
  })
}

/** 提测历史。 */
export function submissionQueryOptions(requirementId: string) {
  return queryOptions({
    queryKey: ['requirements', 'submissions', requirementId],
    queryFn: ({ signal }) => apiClient.listRequirementTestSubmissions(requirementId, undefined, { signal }),
    enabled: Boolean(requirementId),
  })
}
