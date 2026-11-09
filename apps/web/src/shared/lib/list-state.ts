/** 需求/Bug 列表的 URL 可承载状态；详情 ID 只影响打开抽屉，不改变筛选。 */
export interface ListState {
  page: number
  pageSize: number
  search: string
  status: string
  ownerId: string
  openId: string | null
}

export interface ListStateOptions {
  defaultPageSize?: number
  statuses?: readonly string[]
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

function positiveInteger(value: string | null, fallback: number, max?: number): number {
  if (value === null || value.trim() === '' || !/^[0-9]+$/.test(value)) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback
  if (max !== undefined && parsed > max) return max
  return parsed
}

/**
 * 从 URL 查询参数解析列表状态，非法或越界值回退到安全默认值。
 * @param params 当前 URL 查询参数。
 * @param options 默认页大小与允许的状态白名单。
 * @returns 规范化后的列表状态。
 */
export function parseListState(params: URLSearchParams, options: ListStateOptions = {}): ListState {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE
  const status = params.get('status')?.trim() ?? ''
  const allowed = options.statuses
  return {
    page: positiveInteger(params.get('page'), 1),
    pageSize: positiveInteger(params.get('pageSize'), defaultPageSize, MAX_PAGE_SIZE),
    search: (params.get('search') ?? '').trim().slice(0, 200),
    status: allowed && !allowed.includes(status) ? '' : status,
    ownerId: params.get('ownerId')?.trim() ?? '',
    openId: params.get('openId')?.trim() || null,
  }
}

/**
 * 将列表状态写回 URL 查询参数，省略默认值与空筛选。
 * @param state 列表状态。
 * @param options 默认页大小。
 * @returns 新的查询参数，不修改输入 state。
 */
export function toSearchParams(state: ListState, options: ListStateOptions = {}): URLSearchParams {
  const params = new URLSearchParams()
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE
  if (state.page > 1) params.set('page', String(state.page))
  if (state.pageSize !== defaultPageSize) params.set('pageSize', String(state.pageSize))
  if (state.search.trim()) params.set('search', state.search.trim())
  if (state.status) params.set('status', state.status)
  if (state.ownerId) params.set('ownerId', state.ownerId)
  if (state.openId) params.set('openId', state.openId)
  return params
}

/**
 * 更新列表状态；筛选条件变化时自动回到第一页，显式翻页不受影响。
 * @param state 当前状态。
 * @param patch 局部更新；openId 传 null 表示关闭详情。
 * @returns 新状态，不修改输入对象。
 */
export function updateListState(state: ListState, patch: Partial<ListState>): ListState {
  const next = { ...state, ...patch }
  const filtersChanged =
    (patch.search !== undefined && patch.search !== state.search) ||
    (patch.status !== undefined && patch.status !== state.status) ||
    (patch.ownerId !== undefined && patch.ownerId !== state.ownerId)
  if (filtersChanged && patch.page === undefined) next.page = 1
  return next
}

/**
 * 生成稳定的查询缓存键，避免对象属性顺序或 openId 影响列表缓存。
 * @param scope 资源范围，例如 requirements。
 * @param state 列表状态。
 * @returns 只读数组，可直接作为 TanStack Query key。
 */
export function listStateKey(
  scope: string,
  state: ListState,
): readonly [string, string, number, number, string, string, string] {
  return [scope, 'list', state.page, state.pageSize, state.search.trim(), state.status, state.ownerId]
}
