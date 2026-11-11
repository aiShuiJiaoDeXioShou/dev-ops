import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export interface ProjectListFilters {
  search?: string
  status?: 'active' | 'paused' | 'ended'
  page?: number
  pageSize?: number
}

/** 团队项目列表查询。 */
export function projectListQueryOptions(teamId: string, filters: ProjectListFilters) {
  return queryOptions({
    queryKey: ['projects', 'list', teamId, filters],
    queryFn: ({ signal }) => apiClient.listProjects(teamId, filters, { signal }),
    enabled: Boolean(teamId),
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

/**
 * 项目首页晴雨表与项目摘要查询。
 * 晴雨表需要逐个项目读取远端提交/PR，耗时明显长于普通读取，因此：
 * - 首次进入或显式刷新（内存缓存清空）才请求，路由切换使用缓存；
 * - 同一次会话内按团队和筛选条件各缓存一次，不随窗口聚焦或重新挂载反复请求；
 * - 筛选变化时保留旧热力图，静默替换为新结果，避免整块闪烁；
 * - 单次请求使用更长的超时，避免外部 Git 读取慢时误报超时。
 */
export function projectActivityQueryOptions(
  teamId: string,
  filters: {
    search?: string
    status?: 'active' | 'paused' | 'ended'
    source?: 'all' | 'activity' | 'code' | 'pull_request'
  },
) {
  return queryOptions({
    queryKey: ['projects', 'activity', teamId, filters],
    // 不消费 signal：晴雨表本身耗时较长，离开页面时让请求继续完成并写入缓存，
    // 避免路由切回时重新发起；同时避免开发 StrictMode 双重挂载取消首请求后重复请求。
    queryFn: () => apiClient.getProjectActivity(teamId, filters, { timeoutMs: 60_000 }),
    enabled: Boolean(teamId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    placeholderData: keepPreviousData,
  })
}
