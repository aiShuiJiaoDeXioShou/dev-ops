import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 项目产物入口查询。 */
export type ProjectArtifactQuery = ApiQuery<'/api/v1/projects/{projectId}/artifacts', 'get'>
/** 运行版本列表视图。 */
export type RunVersionList = ApiSuccessData<'/api/v1/projects/{projectId}/services/{serviceId}/run-versions', 'get'>

/**
 * 构建项目产物列表查询。
 * @param projectId 项目标识。
 * @param query 产物列表的筛选及分页条件。
 * @returns 按项目和筛选条件区分缓存的查询配置。
 */
export function projectArtifactsQueryOptions(projectId: string, query: ProjectArtifactQuery) {
  return queryOptions({
    queryKey: ['delivery', 'artifacts', projectId, query],
    queryFn: ({ signal }) => apiClient.listProjectArtifacts(projectId, query, { signal }),
    enabled: Boolean(projectId),
  })
}

/**
 * 构建项目服务的运行版本查询。
 * @param projectId 项目标识。
 * @param serviceId 服务标识。
 * @returns 版本列表查询配置，缺少标识时禁用请求。
 */
export function runVersionsQueryOptions(projectId: string, serviceId: string) {
  return queryOptions({
    queryKey: ['delivery', 'run-versions', projectId, serviceId],
    queryFn: ({ signal }) => apiClient.listRunVersions(projectId, serviceId, { signal }),
    enabled: Boolean(projectId && serviceId),
  })
}
