import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export function reviewsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['delivery', 'reviews', projectId],
    queryFn: ({ signal }) => apiClient.listReviews(projectId, { page: 1, pageSize: 50 }, { signal }),
    enabled: Boolean(projectId),
  })
}

export function releasesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['delivery', 'releases', projectId],
    queryFn: ({ signal }) => apiClient.listReleases(projectId, { page: 1, pageSize: 50 }, { signal }),
    enabled: Boolean(projectId),
  })
}
