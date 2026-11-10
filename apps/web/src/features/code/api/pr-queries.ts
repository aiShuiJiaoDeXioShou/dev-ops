import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** PR 列表响应。 */
export type PullRequestList = ApiSuccessData<
  '/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests',
  'get'
>
/** PR 详情响应。 */
export type PullRequestDetail = ApiSuccessData<
  '/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests/{number}',
  'get'
>
export type PullRequestQuery = ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/pull-requests', 'get'>

export function pullRequestsQueryOptions(projectId: string, repositoryId: string, query: PullRequestQuery) {
  return queryOptions({
    queryKey: ['code', 'pull-requests', projectId, repositoryId, query],
    queryFn: ({ signal }) => apiClient.listPullRequests(projectId, repositoryId, query, { signal }),
    enabled: Boolean(projectId && repositoryId),
  })
}

export function pullRequestQueryOptions(projectId: string, repositoryId: string, number: string) {
  return queryOptions({
    queryKey: ['code', 'pull-request', projectId, repositoryId, number],
    queryFn: ({ signal }) => apiClient.getPullRequest(projectId, repositoryId, number, { signal }),
    enabled: Boolean(projectId && repositoryId && number),
  })
}

export function pullRequestDiffQueryOptions(projectId: string, repositoryId: string, number: string) {
  return queryOptions({
    queryKey: ['code', 'pull-request-diff', projectId, repositoryId, number],
    queryFn: ({ signal }) => apiClient.getPullRequestDiff(projectId, repositoryId, number, { signal }),
    enabled: Boolean(projectId && repositoryId && number),
  })
}

/**
 * 读取某仓库的全部 PR，按 100 条一页循环拉取，供 PR 页本地筛选和统计使用。
 * @param projectId 项目标识。
 * @param repositoryId 项目已关联仓库标识。
 * @param signal 请求取消信号。
 * @returns 全部状态下的 PR 摘要；超过 10 页时停止，避免异常仓库拖垮页面。
 */
async function listAllPullRequests(projectId: string, repositoryId: string, signal: AbortSignal) {
  const pageSize = 100
  const items: PullRequestList['items'] = []
  for (let page = 1; page <= 10; page += 1) {
    const result = await apiClient.listPullRequests(
      projectId,
      repositoryId,
      { state: 'all', page, pageSize },
      { signal },
    )
    items.push(...result.data.items)
    if (result.data.items.length < pageSize) break
  }
  return items
}

/** 某仓库全部状态的 PR 列表，用于状态计数、作者/评审筛选与搜索。 */
export function pullRequestsAllQueryOptions(projectId: string, repositoryId: string) {
  return queryOptions({
    queryKey: ['code', 'pull-requests-all', projectId, repositoryId],
    queryFn: ({ signal }) => listAllPullRequests(projectId, repositoryId, signal),
    enabled: Boolean(projectId && repositoryId),
  })
}
