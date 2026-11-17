import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { SkillListItem } from '../model/types'

/** 技能列表筛选条件。 */
export interface SkillListFilters {
  search?: string
  category?: SkillListItem['category']
  page?: number
  pageSize?: number
}

/** 团队技能列表；改筛选或翻页时沿用上一页数据，避免列表在请求期间卸载搜索框。 */
export function skillListQueryOptions(teamId: string, filters: SkillListFilters) {
  return queryOptions({
    queryKey: ['knowledge', 'skills', 'list', teamId, filters],
    queryFn: ({ signal }) => apiClient.listSkills(teamId, filters, { signal }),
    enabled: Boolean(teamId),
    placeholderData: keepPreviousData,
  })
}

/** 读取可配置的团队技能，保留停用条目以供已有配置移除。 */
export function skillChoicesOptions(teamId: string) {
  const pageSize = 100
  return infiniteQueryOptions({
    queryKey: ['knowledge', 'skills', 'choices', teamId],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => apiClient.listSkills(teamId, { page: pageParam, pageSize }, { signal }),
    getNextPageParam: ({ data }) => (data.page * pageSize < data.total ? data.page + 1 : undefined),
  })
}

/** 技能详情。 */
export function skillQueryOptions(skillId: string) {
  return queryOptions({
    queryKey: ['knowledge', 'skills', 'detail', skillId],
    queryFn: ({ signal }) => apiClient.getSkill(skillId, { signal }),
    enabled: Boolean(skillId),
  })
}

/** 技能版本历史。 */
export function skillVersionsQueryOptions(skillId: string, page = 1) {
  return queryOptions({
    queryKey: ['knowledge', 'skills', 'versions', skillId, page],
    queryFn: ({ signal }) => apiClient.listSkillVersions(skillId, { page, pageSize: 20 }, { signal }),
    enabled: Boolean(skillId),
  })
}

/** 技能活动记录。 */
export function skillActivitiesQueryOptions(skillId: string, page = 1) {
  return queryOptions({
    queryKey: ['knowledge', 'skills', 'activities', skillId, page],
    queryFn: ({ signal }) => apiClient.listSkillActivities(skillId, { page, pageSize: 20 }, { signal }),
    enabled: Boolean(skillId),
  })
}
