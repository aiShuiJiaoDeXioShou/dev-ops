import { queryOptions, useQueries, useQuery } from '@tanstack/react-query'
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

/**
 * 汇总团队所有 Git 连接下已同步的仓库，供新建项目时直接选择。
 * @param teamId 团队标识。
 * @param enabled 是否允许立即请求，弹窗关闭时可延迟加载。
 * @returns 扁平仓库列表和加载状态；连接不存在时返回空数组。
 */
export function useTeamRepositories(teamId: string, enabled = true) {
  const connections = useQuery({ ...gitConnectionsQueryOptions(teamId), enabled: enabled && Boolean(teamId) })
  const connectionIds = connections.data?.data.map((connection) => connection.id) ?? []
  const repositoryQueries = useQueries({
    queries: connectionIds.map((connectionId) => connectionRepositoriesQueryOptions(connectionId)),
  })
  return {
    repositories: repositoryQueries.flatMap((query) => query.data?.data.items ?? []),
    isLoading: connections.isPending || repositoryQueries.some((query) => query.isPending),
  }
}
