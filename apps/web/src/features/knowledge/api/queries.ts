import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { SkillListItem } from '../model/types'

/** 技能列表筛选条件。 */
export interface SkillListFilters {
  search?: string
  category?: SkillListItem['category']
  page?: number
  pageSize?: number
}

/** 模板列表筛选条件。 */
export interface TemplateListFilters {
  search?: string
  tag?: string
  page?: number
  pageSize?: number
}

/** 团队技能列表。 */
export function skillListQueryOptions(teamId: string, filters: SkillListFilters) {
  return queryOptions({
    queryKey: ['knowledge', 'skills', 'list', teamId, filters],
    queryFn: ({ signal }) => apiClient.listSkills(teamId, filters, { signal }),
    enabled: Boolean(teamId),
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

/** 团队模板列表。 */
export function templateListQueryOptions(teamId: string, filters: TemplateListFilters) {
  return queryOptions({
    queryKey: ['knowledge', 'templates', 'list', teamId, filters],
    queryFn: ({ signal }) => apiClient.listAgentTemplates(teamId, filters, { signal }),
    enabled: Boolean(teamId),
  })
}

/** 模板详情。 */
export function templateQueryOptions(templateId: string) {
  return queryOptions({
    queryKey: ['knowledge', 'templates', 'detail', templateId],
    queryFn: ({ signal }) => apiClient.getAgentTemplate(templateId, { signal }),
    enabled: Boolean(templateId),
  })
}

/** 模板版本历史。 */
export function templateVersionsQueryOptions(templateId: string, page = 1) {
  return queryOptions({
    queryKey: ['knowledge', 'templates', 'versions', templateId, page],
    queryFn: ({ signal }) => apiClient.listAgentTemplateVersions(templateId, { page, pageSize: 20 }, { signal }),
    enabled: Boolean(templateId),
  })
}

/** 模板活动记录。 */
export function templateActivitiesQueryOptions(templateId: string, page = 1) {
  return queryOptions({
    queryKey: ['knowledge', 'templates', 'activities', templateId, page],
    queryFn: ({ signal }) => apiClient.listAgentTemplateActivities(templateId, { page, pageSize: 20 }, { signal }),
    enabled: Boolean(templateId),
  })
}

/** 项目当前选用模板。 */
export function projectAgentTemplateQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['knowledge', 'project-template', projectId],
    queryFn: ({ signal }) => apiClient.getProjectAgentTemplate(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 模板快照内容。 */
export function templateSnapshotQueryOptions(token: string) {
  return queryOptions({
    queryKey: ['knowledge', 'snapshot', token],
    queryFn: ({ signal }) => apiClient.getTemplateSnapshot(token, { signal }),
    enabled: Boolean(token),
  })
}
