import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

export type CommitListQuery = ApiQuery<'/api/v1/projects/{projectId}/repositories/{repositoryId}/commits', 'get'>

export function commitsQueryOptions(
  projectId: string,
  repositoryId: string,
  query: CommitListQuery,
) {
  return queryOptions({
    queryKey: ['code', 'commits', projectId, repositoryId, query],
    queryFn: ({ signal }) => apiClient.listCommits(projectId, repositoryId, query, { signal }),
    enabled: Boolean(projectId && repositoryId),
  })
}

export function commitQueryOptions(projectId: string, repositoryId: string, ref: string) {
  return queryOptions({
    queryKey: ['code', 'commit', projectId, repositoryId, ref],
    queryFn: ({ signal }) => apiClient.getCommit(projectId, repositoryId, ref, { signal }),
    enabled: Boolean(projectId && repositoryId && ref),
  })
}
