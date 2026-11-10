import { parseListState, toSearchParams, updateListState, type ListState } from '@/shared/lib/list-state'

export const PROJECT_STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const
export type ProjectStatus = keyof typeof PROJECT_STATUS_LABELS

export function parseProjectFilters(params: URLSearchParams): ListState {
  return parseListState(params, { statuses: ['active', 'paused', 'ended'] })
}

export function projectFilterParams(state: ListState): URLSearchParams {
  return toSearchParams(state)
}

export function updateProjectFilters(state: ListState, patch: Partial<ListState>): ListState {
  return updateListState(state, patch)
}
