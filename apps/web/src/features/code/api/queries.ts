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
/**
 * 读取项目可关联的全部仓库；按接口分页上限循环拉取，避免只看到第一页。
 * @param projectId 项目标识。
 * @param signal 请求取消信号。
 * @returns 团队有效连接下可用的仓库，包含来源状态与默认分支。
 */
async function listAllAvailableRepositories(projectId: string, signal: AbortSignal) {
  const pageSize = 100
  const first = await apiClient.listAvailableRepositories(projectId, { page: 1, pageSize }, { signal })
  const repositories = [...first.data.items]
  const lastPage = Math.ceil(first.data.total / pageSize)
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await apiClient.listAvailableRepositories(projectId, { page, pageSize }, { signal })
    repositories.push(...next.data.items)
  }
  return repositories
}

/** 项目可关联仓库。 */
export function availableRepositoriesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['code', 'available-repositories', projectId, 'all'],
    queryFn: ({ signal }) => listAllAvailableRepositories(projectId, signal),
    enabled: Boolean(projectId),
  })
}

/**
 * 读取单条连接下的全部仓库，按接口分页上限循环拉取，避免新建项目时只看到第一页。
 * @param connectionId Git 连接标识。
 * @param signal 请求取消信号。
 * @returns 该连接已同步的全部仓库。
 */
async function listAllConnectionRepositories(connectionId: string, signal: AbortSignal) {
  const pageSize = 100
  const first = await apiClient.listGitConnectionRepositories(connectionId, { page: 1, pageSize }, { signal })
  const repositories = [...first.data.items]
  const lastPage = Math.ceil(first.data.total / pageSize)
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await apiClient.listGitConnectionRepositories(connectionId, { page, pageSize }, { signal })
    repositories.push(...next.data.items)
  }
  return repositories
}

/**
 * 汇总团队所有有效 Git 连接下可用的仓库，供新建项目时直接选择。
 * 已撤销连接不再提供仓库；同一远端仓库可能同时存在于多条连接中，按提供方与 Web 地址去重。
 * @param teamId 团队标识。
 * @param enabled 是否允许立即请求，弹窗关闭时可延迟加载。
 * @returns 去重后的仓库列表和加载状态；连接不存在时返回空数组。
 */
export function useTeamRepositories(teamId: string, enabled = true) {
  const connections = useQuery({ ...gitConnectionsQueryOptions(teamId), enabled: enabled && Boolean(teamId) })
  const connectionIds =
    connections.data?.data.filter((connection) => connection.status === 'active').map((connection) => connection.id) ??
    []
  const repositoryQueries = useQueries({
    queries: connectionIds.map((connectionId) =>
      queryOptions({
        queryKey: ['code', 'connection-repositories', connectionId, 'all'],
        queryFn: ({ signal }) => listAllConnectionRepositories(connectionId, signal),
        enabled: Boolean(connectionId),
      }),
    ),
  })
  const repositories = repositoryQueries
    .flatMap((query) => query.data ?? [])
    .filter((repository) => repository.status === 'available')
  const uniqueRepositories = [
    ...new Map(
      repositories.map((repository) => [`${repository.providerKey}:${repository.webUrl}`, repository]),
    ).values(),
  ]
  return {
    repositories: uniqueRepositories,
    isLoading: connections.isPending || repositoryQueries.some((query) => query.isPending),
  }
}

/** 仓库文件树。 */
export function repositoryTreeQueryOptions(projectId: string, repositoryId: string, branch?: string) {
  return queryOptions({
    queryKey: ['code', 'tree', projectId, repositoryId, branch],
    queryFn: ({ signal }) =>
      apiClient.listRepositoryTree(projectId, repositoryId, branch ? { branch } : undefined, { signal }),
    enabled: Boolean(projectId && repositoryId),
  })
}

/** 仓库文件内容。 */
export function repositoryFileQueryOptions(
  projectId: string,
  repositoryId: string,
  branch: string | undefined,
  path: string,
) {
  return queryOptions({
    queryKey: ['code', 'file', projectId, repositoryId, branch, path],
    queryFn: ({ signal }) =>
      apiClient.getRepositoryFile(projectId, repositoryId, { ...(branch ? { branch } : {}), path }, { signal }),
    enabled: Boolean(projectId && repositoryId && path),
  })
}

/** 仓库分支列表。 */
export function repositoryBranchesQueryOptions(projectId: string, repositoryId: string) {
  return queryOptions({
    queryKey: ['code', 'branches', projectId, repositoryId],
    queryFn: ({ signal }) => apiClient.listRepositoryBranches(projectId, repositoryId, { signal }),
    enabled: Boolean(projectId && repositoryId),
  })
}

/** 项目已关联仓库列表。 */
export function listProjectRepositoriesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['code', 'repositories', projectId],
    queryFn: ({ signal }) => apiClient.listProjectRepositories(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}
