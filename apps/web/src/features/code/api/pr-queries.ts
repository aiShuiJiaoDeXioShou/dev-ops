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
