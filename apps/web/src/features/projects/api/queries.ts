import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { readAllPages } from '@/shared/api/read-all-pages'

export interface ProjectListFilters {
  search?: string
  status?: 'active' | 'paused' | 'ended'
  repositoryId?: string
  page?: number
  pageSize?: number
}

/**
 * 读取已关联到团队项目的仓库名称，供首页选择器查找。
 * @param teamId 当前团队标识。
 * @returns 按团队缓存的仓库选项查询。
 */
export function projectRepositoryOptionsQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: ['projects', 'repository-options', teamId],
    queryFn: ({ signal }) => readAllPages((page) => apiClient.listProjectRepositoryOptions(teamId, page, { signal })),
    enabled: Boolean(teamId),
  })
}

/** 团队项目列表查询；改筛选或翻页时沿用上一页数据，避免列表在请求期间卸载搜索框。 */
export function projectListQueryOptions(teamId: string, filters: ProjectListFilters) {
  return queryOptions({
    queryKey: ['projects', 'list', teamId, filters],
    queryFn: ({ signal }) => apiClient.listProjects(teamId, filters, { signal }),
    enabled: Boolean(teamId),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === teamId ? previousData : undefined,
  })
}

/** 单个项目详情。 */
export function projectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', 'detail', projectId],
    queryFn: ({ signal }) => apiClient.getProject(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 项目事项统计。 */
export function projectStatsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', 'stats', projectId],
    queryFn: ({ signal }) => apiClient.getProjectStats(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 项目服务目录查询。 */
export function projectServicesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['projects', 'services', projectId],
    queryFn: ({ signal }) => apiClient.listProjectServices(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}

const PROJECT_ACTIVITY_REFRESH_MS = 60_000

/**
 * 读取项目晴雨表和项目摘要，在页面打开期间定期读取 Worker 已发布的本地统计。
 * @param teamId 当前团队标识。
 * @param filters 活动来源、项目名称、状态和仓库筛选。
 * @returns 按团队和筛选缓存的查询配置；同团队切换筛选时保留上一份结果。
 */
export function projectActivityQueryOptions(
  teamId: string,
  filters: {
    search?: string
    status?: 'active' | 'paused' | 'ended'
    repositoryId?: string
    source?: 'all' | 'activity' | 'code' | 'pull_request'
  },
) {
  return queryOptions({
    queryKey: ['projects', 'activity', teamId, filters],
    queryFn: ({ signal }) => apiClient.getProjectActivity(teamId, filters, { signal }),
    enabled: Boolean(teamId),
    staleTime: PROJECT_ACTIVITY_REFRESH_MS,
    refetchInterval: PROJECT_ACTIVITY_REFRESH_MS,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === teamId ? previousData : undefined,
  })
}
