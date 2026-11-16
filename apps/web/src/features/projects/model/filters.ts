import type { ApiQuery } from '@dev-ops/api-client'
import { parseListState, toSearchParams, updateListState, type ListState } from '@/shared/lib/list-state'

export const PROJECT_STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const
const PROJECT_STATUSES = Object.keys(PROJECT_STATUS_LABELS)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 仓库条件可为具体仓库，也可按有无仓库过滤。 */
export const REPOSITORY_LINKED = 'linked'
export const REPOSITORY_UNLINKED = 'unlinked'

export interface ProjectCriteria {
  status: string
  repository: string
  ownerId: string
  ownerUnavailable: boolean
}

/** 项目筛选面板的初始条件。 */
export const EMPTY_PROJECT_CRITERIA: ProjectCriteria = {
  status: '',
  repository: '',
  ownerId: '',
  ownerUnavailable: false,
}

type ProjectFilters = ListState & ProjectCriteria
type ProjectQueryFilters = Omit<ApiQuery<'/api/v1/teams/{teamId}/projects', 'get'>, 'page' | 'pageSize'>

function normalizeId(value: string): string {
  const id = value.trim()
  return UUID_PATTERN.test(id) ? id.toLowerCase() : ''
}

function isProjectStatus(status: string): status is keyof typeof PROJECT_STATUS_LABELS {
  return Object.hasOwn(PROJECT_STATUS_LABELS, status)
}

/**
 * 从 URL 恢复项目列表的筛选和分页。
 * @param params URL 查询参数。
 * @returns 标准化的列表状态，具体仓库优先于仓库关联状态。
 */
export function parseProjectFilters(params: URLSearchParams): ProjectFilters {
  const list = parseListState(params, { statuses: PROJECT_STATUSES })
  const repositoryId = normalizeId(params.get('repositoryId') ?? '')
  const hasRepository = params.get('hasRepository')
  let presence = ''
  if (hasRepository === 'true') presence = REPOSITORY_LINKED
  if (hasRepository === 'false') presence = REPOSITORY_UNLINKED
  return {
    ...list,
    repository: repositoryId || presence,
    ownerId: normalizeId(list.ownerId),
    ownerUnavailable: params.get('ownerUnavailable') === 'true',
  }
}

/**
 * 生成项目列表和晴雨表共用的过滤参数。
 * @param state 当前筛选和分页状态。
 * @returns 只包含筛选条件，分页或统计来源由调用者设置。
 */
export function toProjectQueryFilters(state: ProjectFilters): ProjectQueryFilters {
  const filtersByPresence = state.repository === REPOSITORY_LINKED || state.repository === REPOSITORY_UNLINKED
  return {
    search: state.search || undefined,
    status: isProjectStatus(state.status) ? state.status : undefined,
    repositoryId: filtersByPresence ? undefined : state.repository || undefined,
    hasRepository: filtersByPresence ? state.repository === REPOSITORY_LINKED : undefined,
    ownerId: state.ownerId || undefined,
    ownerUnavailable: state.ownerUnavailable || undefined,
  }
}

/**
 * 把项目列表状态转换成可分享的查询参数。
 * @param state 当前筛选和分页状态。
 * @returns 用于写回 URL 的参数，具体仓库继续使用既有 repositoryId。
 */
export function projectFilterParams(state: ProjectFilters): URLSearchParams {
  const params = toSearchParams(state)
  const { repositoryId, hasRepository, ownerUnavailable } = toProjectQueryFilters(state)
  if (repositoryId) params.set('repositoryId', repositoryId)
  if (hasRepository !== undefined) params.set('hasRepository', String(hasRepository))
  if (ownerUnavailable) params.set('ownerUnavailable', 'true')
  return params
}

/**
 * 更新项目列表状态。
 * @param state 更新前的筛选和分页状态。
 * @param patch 需要修改的字段。
 * @returns 合并后的状态，筛选变化且未指定页码时回到第一页。
 */
export function updateProjectFilters(state: ProjectFilters, patch: Partial<ProjectFilters>): ProjectFilters {
  const next = { ...state, ...patch, ...updateListState(state, patch) }
  const changed = next.repository !== state.repository || next.ownerUnavailable !== state.ownerUnavailable
  return { ...next, page: changed && patch.page === undefined ? 1 : next.page }
}

/**
 * 统计项目筛选面板已设置的条件数量。
 * @param criteria 状态、仓库和负责人的筛选条件。
 * @returns 已设置的条件数，独立搜索框的文字不计入。
 */
export function countProjectCriteria(criteria: ProjectCriteria): number {
  return [criteria.status, criteria.repository, criteria.ownerId, criteria.ownerUnavailable].filter(Boolean).length
}
