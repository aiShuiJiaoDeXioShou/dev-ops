import { parseListState, toSearchParams, updateListState, type ListState } from '@/shared/lib/list-state'

export const PROJECT_STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const
export type ProjectStatus = keyof typeof PROJECT_STATUS_LABELS

/**
 * 从 URL 恢复项目列表的筛选和分页。
 * @param params URL 查询参数。
 * @returns 标准化后的列表状态，未知状态筛选按默认值处理。
 */
export function parseProjectFilters(params: URLSearchParams): ListState {
  return parseListState(params, { statuses: ['active', 'paused', 'ended'] })
}

/**
 * 把项目列表状态转换成可分享的查询参数。
 * @param state 当前筛选和分页状态。
 * @returns 用于写回 URL 的参数。
 */
export function projectFilterParams(state: ListState): URLSearchParams {
  return toSearchParams(state)
}

/**
 * 更新项目列表状态。
 * @param state 更新前的筛选和分页状态。
 * @param patch 需要修改的字段。
 * @returns 合并后的状态，筛选变化且未指定页码时回到第一页。
 */
export function updateProjectFilters(state: ListState, patch: Partial<ListState>): ListState {
  return updateListState(state, patch)
}
