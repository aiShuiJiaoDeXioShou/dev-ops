import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

/** 团队 Git 连接。 */
export function gitConnectionsQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: ['code', 'connections', teamId],
    queryFn: ({ signal }) => apiClient.listGitConnections(teamId, { signal }),
    enabled: Boolean(teamId),
  })
}
/** 团队连接的仓库。 */
export function connectionRepositoriesQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: ['code', 'connection-repositories', connectionId],
    queryFn: ({ signal }) => apiClient.listGitConnectionRepositories(connectionId, undefined, { signal }),
    enabled: Boolean(connectionId),
  })
}
/** 项目已关联仓库。 */
export function projectRepositoriesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['code', 'project-repositories', projectId],
    queryFn: ({ signal }) => apiClient.listProjectRepositories(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}
/** 项目可关联仓库。 */
export function availableRepositoriesQueryOptions(projectId: string, search = '') {
  return queryOptions({
    queryKey: ['code', 'available-repositories', projectId, search],
    queryFn: ({ signal }) =>
      apiClient.listAvailableRepositories(projectId, search ? { search } : undefined, { signal }),
    enabled: Boolean(projectId),
  })
}
