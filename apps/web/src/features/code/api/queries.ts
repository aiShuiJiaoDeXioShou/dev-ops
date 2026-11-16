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
 * 已撤销连接不再提供仓库；同一远端仓库保留不同连接下的候选项。
 * @param teamId 团队标识。
 * @param enabled 是否允许立即请求，弹窗关闭时可延迟加载。
 * @returns 按连接区分的仓库列表和加载状态；连接不存在时返回空数组。
 */
export function useTeamRepositories(teamId: string, enabled = true) {
  const connections = useQuery({ ...gitConnectionsQueryOptions(teamId), enabled: enabled && Boolean(teamId) })
  const activeConnections = connections.data?.data.filter((connection) => connection.status === 'active') ?? []
  const repositoryQueries = useQueries({
    queries: activeConnections.map(({ id: connectionId }) =>
      queryOptions({
        queryKey: ['code', 'connection-repositories', connectionId, 'all'],
        queryFn: ({ signal }) => listAllConnectionRepositories(connectionId, signal),
        enabled: enabled && Boolean(connectionId),
      }),
    ),
  })
  const repositories = repositoryQueries
    .flatMap((query) => query.data ?? [])
    .filter((repository) => repository.status === 'available')
  return {
    repositories,
    connections: activeConnections,
    hasError: connections.isError || repositoryQueries.some((query) => query.isError),
    retry: () =>
      Promise.all([
        connections.refetch(),
        ...repositoryQueries.filter((query) => query.isError).map((query) => query.refetch()),
      ]),
    isLoading: connections.isPending || repositoryQueries.some((query) => query.isPending),
  }
}

const REPOSITORY_READ_STALE_TIME = 60_000

/**
 * 按项目、仓库、分支和目录缓存一层子项；空路径读取根目录。
 * @param projectId 项目标识。
 * @param repositoryId 已关联的仓库标识。
 * @param branch 选中的分支，省略时由服务端解析默认分支。
 * @param path 仓库相对目录路径。
 * @returns 目录查询配置，缓存有效期内重新展开不会发请求。
 */
export function repositoryTreeQueryOptions(projectId: string, repositoryId: string, branch?: string, path = '') {
  return queryOptions({
    queryKey: ['code', 'tree', projectId, repositoryId, branch, path],
    queryFn: ({ signal }) => apiClient.listRepositoryTree(projectId, repositoryId, { branch, path }, { signal }),
    enabled: Boolean(projectId && repositoryId),
    staleTime: REPOSITORY_READ_STALE_TIME,
  })
}

/**
 * 按项目、仓库、分支和文件路径缓存已读取的文件内容。
 * @param projectId 项目标识。
 * @param repositoryId 已关联的仓库标识。
 * @param branch 已解析的分支，缺省时等待根目录加载。
 * @param path 仓库相对文件路径。
 * @returns 文件查询配置，缓存有效期内重复打开复用正文。
 */
export function repositoryFileQueryOptions(
  projectId: string,
  repositoryId: string,
  branch: string | undefined,
  path: string,
) {
  return queryOptions({
    queryKey: ['code', 'file', projectId, repositoryId, branch, path],
    queryFn: ({ signal }) => apiClient.getRepositoryFile(projectId, repositoryId, { branch, path }, { signal }),
    enabled: Boolean(projectId && repositoryId && branch && path),
    staleTime: REPOSITORY_READ_STALE_TIME,
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
