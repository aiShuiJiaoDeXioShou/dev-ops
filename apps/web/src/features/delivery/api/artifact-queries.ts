import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 项目产物入口查询。 */
export type ProjectArtifactQuery = ApiQuery<'/api/v1/projects/{projectId}/artifacts', 'get'>
/** 运行版本列表视图。 */
export type RunVersionList = ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions', 'get'>

export function projectArtifactsQueryOptions(projectId: string, query: ProjectArtifactQuery) {
  return queryOptions({
    queryKey: ['delivery', 'artifacts', projectId, query],
    queryFn: ({ signal }) => apiClient.listProjectArtifacts(projectId, query, { signal }),
    enabled: Boolean(projectId),
  })
}

export function runVersionsQueryOptions(projectId: string, serviceId: string) {
  return queryOptions({
    queryKey: ['delivery', 'run-versions', projectId, serviceId],
    queryFn: ({ signal }) => apiClient.listRunVersions(projectId, serviceId, { signal }),
    enabled: Boolean(projectId && serviceId),
  })
}
