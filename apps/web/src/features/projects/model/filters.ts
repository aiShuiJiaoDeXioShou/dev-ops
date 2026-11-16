import { parseListState, toSearchParams, updateListState, type ListState } from '@/shared/lib/list-state'

export const PROJECT_STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const
type ProjectFilters = ListState & { repositoryId: string }

const REPOSITORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 从 URL 恢复项目列表的筛选和分页。
 * @param params URL 查询参数。
 * @returns 标准化后的列表状态，未知状态筛选按默认值处理。
 */
export function parseProjectFilters(params: URLSearchParams): ProjectFilters {
  const repositoryId = params.get('repositoryId')?.trim() ?? ''
  return {
    ...parseListState(params, { statuses: ['active', 'paused', 'ended'] }),
    repositoryId: REPOSITORY_ID_PATTERN.test(repositoryId) ? repositoryId.toLowerCase() : '',
  }
}

/**
 * 把项目列表状态转换成可分享的查询参数。
 * @param state 当前筛选和分页状态。
 * @returns 用于写回 URL 的参数。
 */
export function projectFilterParams(state: ProjectFilters): URLSearchParams {
  const params = toSearchParams(state)
  if (state.repositoryId) params.set('repositoryId', state.repositoryId)
  return params
}

/**
 * 更新项目列表状态。
 * @param state 更新前的筛选和分页状态。
 * @param patch 需要修改的字段。
 * @returns 合并后的状态，筛选变化且未指定页码时回到第一页。
 */
export function updateProjectFilters(state: ProjectFilters, patch: Partial<ProjectFilters>): ProjectFilters {
  const next = updateListState(state, patch)
  const repositoryId = patch.repositoryId ?? state.repositoryId
  return {
    ...next,
    repositoryId,
    page: patch.page ?? (repositoryId === state.repositoryId ? next.page : 1),
  }
}
