import { queryOptions } from '@tanstack/react-query'
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
