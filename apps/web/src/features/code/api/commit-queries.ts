import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

export type CommitListQuery = ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/commits', 'get'>

/**
 * 构建仓库提交列表查询。
 * @param projectId 项目标识。
 * @param repositoryId 仓库标识。
 * @param query 分支、筛选与分页条件。
 * @returns 按仓库和条件区分缓存的查询配置。
 */
export function commitsQueryOptions(projectId: string, repositoryId: string, query: CommitListQuery) {
  return queryOptions({
    queryKey: ['code', 'commits', projectId, repositoryId, query],
    queryFn: ({ signal }) => apiClient.listCommits(projectId, repositoryId, query, { signal }),
    enabled: Boolean(projectId && repositoryId),
  })
}

/**
 * 构建指定提交的详情查询。
 * @param projectId 项目标识。
 * @param repositoryId 仓库标识。
 * @param ref 提交引用。
 * @returns 提交详情查询配置，缺少任一标识时禁用请求。
 */
export function commitQueryOptions(projectId: string, repositoryId: string, ref: string) {
  return queryOptions({
    queryKey: ['code', 'commit', projectId, repositoryId, ref],
    queryFn: ({ signal }) => apiClient.getCommit(projectId, repositoryId, ref, { signal }),
    enabled: Boolean(projectId && repositoryId && ref),
  })
}
