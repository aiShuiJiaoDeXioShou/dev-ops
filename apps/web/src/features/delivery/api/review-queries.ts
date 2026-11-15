import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

/**
 * 构建项目评审列表查询。
 * @param projectId 项目标识。
 * @returns 评审列表查询配置，项目为空时禁用请求。
 */
export function reviewsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['delivery', 'reviews', projectId],
    queryFn: ({ signal }) => apiClient.listReviews(projectId, { page: 1, pageSize: 50 }, { signal }),
    enabled: Boolean(projectId),
  })
}

/**
 * 构建项目发布列表查询。
 * @param projectId 项目标识。
 * @returns 发布列表查询配置，项目为空时禁用请求。
 */
export function releasesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['delivery', 'releases', projectId],
    queryFn: ({ signal }) => apiClient.listReleases(projectId, { page: 1, pageSize: 50 }, { signal }),
    enabled: Boolean(projectId),
  })
}
