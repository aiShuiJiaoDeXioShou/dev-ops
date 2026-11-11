import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 变更计划列表视图。 */
export type ChangePlanListView = ApiSuccessData<'/api/v1/teams/{teamId}/change-plans', 'get'>
/** 变更计划详情视图。 */
export type ChangePlanDetailView = ApiSuccessData<'/api/v1/change-plans/{planId}', 'get'>
/** 变更列表筛选参数。 */
export type ChangePlanListQuery = ApiQuery<'/api/v1/teams/{teamId}/change-plans', 'get'>

/** 团队变更计划列表查询。 */
export function changePlanListQueryOptions(teamId: string, query: ChangePlanListQuery) {
  return queryOptions({
    queryKey: ['operations', 'change-plans', teamId, query],
    queryFn: ({ signal }) => apiClient.listChangePlans(teamId, query, { signal }),
    enabled: Boolean(teamId),
  })
}

/** 变更计划详情查询；详情内已包含放行、执行与事件摘要。 */
export function changePlanQueryOptions(planId: string) {
  return queryOptions({
    queryKey: ['operations', 'change-plan', planId],
    queryFn: ({ signal }) => apiClient.getChangePlan(planId, { signal }),
    enabled: Boolean(planId),
  })
}
