import type { ApiBody, ApiSuccessData } from '@dev-ops/api-client'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export type WorkTag = ApiSuccessData<'/api/v1/teams/{teamId}/work-tags', 'get'>['items'][number]
export type WorkTagTarget = ApiBody<'/api/v1/work-tags/{tagId}/link', 'post'>
export const workTagQueries = ['work-tags']

/** 分页读取团队的标签目录。 */
export function workTagsOptions(teamId: string) {
  return infiniteQueryOptions({
    queryKey: [...workTagQueries, teamId],
    queryFn: ({ signal, pageParam }) => apiClient.listWorkTags(teamId, { cursor: pageParam || undefined }, { signal }),
    initialPageParam: '',
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })
}
