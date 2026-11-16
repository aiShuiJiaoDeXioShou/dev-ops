import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { loadUserRefs, userRefOf } from '../identity/identity.display.ts'
import { findProjects } from './projects.repository.ts'
import { DASHBOARD_DAY_MS, DASHBOARD_WINDOW_DAYS } from './projects.dashboard.constants.ts'
import {
  findDailyActivity,
  findProjectItemCounts,
  readDashboardRepositoryActivity,
} from './projects.dashboard.repository.ts'

export const DASHBOARD_SOURCES = ['all', 'activity', 'code', 'pull_request'] as const
export type DashboardSource = (typeof DASHBOARD_SOURCES)[number]
export interface DashboardQuery {
  source?: string
  search?: string
  status?: string
  from?: string
  to?: string
}

export interface ProjectActivityDay {
  date: string
  total: number
  counts: { activity: number; code: number; pullRequest: number }
}

export interface ProjectActivityProject {
  projectId: string
  status: string
  owner: { userId: string; name: string; available: boolean }
  items: { total: number; completed: number }
  pendingRequirements: number
  pendingBugs: number
  pendingPullRequests: number | null
  bots: null
}

export interface ProjectActivityResult {
  timezone: 'UTC'
  from: string
  to: string
  source: DashboardSource
  sourceStatus: { activity: string; code: string; pullRequest: string }
  days: ProjectActivityDay[]
  projects: ProjectActivityProject[]
}

function isSource(value: string): value is DashboardSource {
  return (DASHBOARD_SOURCES as readonly string[]).includes(value)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseDate(value: string, name: string): Date {
  if (!DATE_PATTERN.test(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}格式必须为 YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (value.startsWith('0000-') || Number.isNaN(date.getTime()) || dateOf(date) !== value) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不是有效日期`)
  }
  return date
}

function dateOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DASHBOARD_DAY_MS)
}

/** 判断字符串是否为项目状态。 */
function isProjectStatus(value: string): value is 'active' | 'paused' | 'ended' {
  return value === 'active' || value === 'paused' || value === 'ended'
}

/**
 * 创建项目首页晴雨表服务。
 * @param deps 数据库连接。
 * @returns 按团队聚合活动与项目摘要的用例。
 */
export function createProjectDashboardService(deps: { db: Database }) {
  const { db } = deps

  async function getProjectActivity(
    actor: SessionUser,
    teamId: string,
    query: DashboardQuery,
  ): Promise<ProjectActivityResult> {
    await requireTeamMember(db, actor.id, teamId)
    const source: DashboardSource = query.source
      ? isSource(query.source)
        ? query.source
        : (() => {
            throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '活动来源不合法')
          })()
      : 'all'
    const now = new Date()
    const today = new Date(`${dateOf(now)}T00:00:00.000Z`)
    // 默认窗口对齐到周日，前端按原型 53×7 热力图直接布局；上限仍为 371 天。
    const weekStart = addDays(today, -today.getUTCDay())
    const from = query.from ? parseDate(query.from, '开始日期') : addDays(weekStart, -52 * 7)
    const to = query.to ? parseDate(query.to, '结束日期') : today
    if (to.getTime() < from.getTime()) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '结束日期不能早于开始日期')
    if ((to.getTime() - from.getTime()) / DASHBOARD_DAY_MS + 1 > DASHBOARD_WINDOW_DAYS) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `日期窗口最多 ${DASHBOARD_WINDOW_DAYS} 天`)
    }
    if (query.status !== undefined && !isProjectStatus(query.status)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '项目状态不合法')
    }
    const { rows: projectRows } = await findProjects(db, teamId, {
      search: query.search?.trim() || undefined,
      status: query.status,
      page: 1,
      pageSize: 100,
    })
    const projectIds = projectRows.map((row) => row.id)
    const fromDate = dateOf(from)
    const toDate = dateOf(to)
    const [itemCounts, activityRows, repositoryActivity, ownerRefs] = await Promise.all([
      findProjectItemCounts(db, projectIds),
      source === 'all' || source === 'activity' ? findDailyActivity(db, projectIds, from, addDays(to, 1)) : [],
      source === 'activity'
        ? null
        : readDashboardRepositoryActivity(db, {
            teamId,
            projectIds,
            from: fromDate,
            to: toDate,
            source,
            now,
          }),
      loadUserRefs(
        db,
        projectRows.map((row) => row.owner_user_id),
      ),
    ])
    const sourceStatus = {
      activity: 'ok',
      code: repositoryActivity?.codeOk ? 'ok' : 'unknown',
      pullRequest: repositoryActivity?.pullRequestOk ? 'ok' : 'unknown',
    }
    const activityByDay = new Map<string, number>()
    for (const row of activityRows) {
      activityByDay.set(row.date, (activityByDay.get(row.date) ?? 0) + row.value)
    }
    const days: ProjectActivityDay[] = []
    for (let offset = 0; offset <= (to.getTime() - from.getTime()) / DASHBOARD_DAY_MS; offset += 1) {
      const date = dateOf(addDays(from, offset))
      const counts = {
        activity: activityByDay.get(date) ?? 0,
        code: repositoryActivity?.codeByDay.get(date) ?? 0,
        pullRequest: repositoryActivity?.pullRequestByDay.get(date) ?? 0,
      }
      const total = counts.activity + counts.code + counts.pullRequest
      days.push({ date, total, counts })
    }
    return {
      timezone: 'UTC',
      from: fromDate,
      to: toDate,
      source,
      sourceStatus,
      days,
      projects: projectRows.map((row) => {
        const item = itemCounts.get(row.id) ?? { total: 0, completed: 0, pendingRequirements: 0, pendingBugs: 0 }
        const openPullRequests = repositoryActivity?.pendingByProject.get(row.id)
        return {
          projectId: row.id,
          status: row.status,
          owner: (() => {
            const ref = userRefOf(row.owner_user_id, ownerRefs)
            return ref
              ? { userId: ref.userId, name: ref.name, available: true }
              : { userId: row.owner_user_id, name: '未知用户', available: false }
          })(),
          items: { total: item.total, completed: item.completed },
          pendingRequirements: item.pendingRequirements,
          pendingBugs: item.pendingBugs,
          pendingPullRequests: repositoryActivity && openPullRequests === undefined ? 0 : (openPullRequests ?? null),
          bots: null,
        }
      }),
    }
  }

  return { getProjectActivity }
}

export type ProjectDashboardService = ReturnType<typeof createProjectDashboardService>
