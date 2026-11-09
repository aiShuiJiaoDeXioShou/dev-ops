import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export type CollabTarget = 'requirement' | 'bug'

/** 评论列表查询。 */
export function commentsQueryOptions(target: CollabTarget, targetId: string, page = 1, pageSize = 50) {
  return queryOptions({
    queryKey: ['collaboration', 'comments', target, targetId, page, pageSize],
    queryFn: ({ signal }) =>
      target === 'requirement'
        ? apiClient.listRequirementComments(targetId, { page, pageSize }, { signal })
        : apiClient.listBugComments(targetId, { page, pageSize }, { signal }),
    enabled: Boolean(targetId),
  })
}

/** 活动时间线查询。 */
export function activitiesQueryOptions(target: CollabTarget, targetId: string, page = 1, pageSize = 50) {
  return queryOptions({
    queryKey: ['collaboration', 'activities', target, targetId, page, pageSize],
    queryFn: ({ signal }) =>
      target === 'requirement'
        ? apiClient.listRequirementActivities(targetId, { page, pageSize }, { signal })
        : apiClient.listBugActivities(targetId, { page, pageSize }, { signal }),
    enabled: Boolean(targetId),
  })
}
