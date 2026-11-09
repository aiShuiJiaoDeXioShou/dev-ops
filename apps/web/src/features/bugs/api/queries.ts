import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export type BugListStatus = 'pending' | 'in_fix' | 'in_regression' | 'resolved' | 'closed'
export interface BugListFilters {
  search?: string
  status?: BugListStatus
  ownerId?: string
  page?: number
  pageSize?: number
}
export function bugListQueryOptions(projectId: string, filters: BugListFilters) {
  return queryOptions({
    queryKey: ['bugs', 'list', projectId, filters],
    queryFn: ({ signal }) => apiClient.listBugs(projectId, filters, { signal }),
    enabled: Boolean(projectId),
  })
}
export function bugQueryOptions(bugId: string) {
  return queryOptions({
    queryKey: ['bugs', 'detail', bugId],
    queryFn: ({ signal }) => apiClient.getBug(bugId, { signal }),
    enabled: Boolean(bugId),
  })
}
