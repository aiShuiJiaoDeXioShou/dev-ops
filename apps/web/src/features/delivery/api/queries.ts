import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 构建记录详情视图。 */
export type BuildView = ApiSuccessData<'/api/v1/builds/{buildId}', 'get'>
/** 构建记录列表视图。 */
export type BuildListView = ApiSuccessData<'/api/v1/projects/{projectId}/builds', 'get'>
/** 构建列表筛选参数。 */
export type BuildListQuery = ApiQuery<'/api/v1/projects/{projectId}/builds', 'get'>

/** 项目构建记录列表查询。 */
export function buildListQueryOptions(projectId: string, filters: BuildListQuery = {}) {
  return queryOptions({
    queryKey: ['delivery', 'builds', projectId, filters],
    queryFn: ({ signal }) => apiClient.listBuilds(projectId, filters, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 构建记录详情查询。 */
export function buildQueryOptions(buildId: string) {
  return queryOptions({
    queryKey: ['delivery', 'build', buildId],
    queryFn: ({ signal }) => apiClient.getBuild(buildId, { signal }),
    enabled: Boolean(buildId),
  })
}
