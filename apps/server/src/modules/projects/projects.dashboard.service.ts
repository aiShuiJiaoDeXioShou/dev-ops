import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { loadUserRefs, userRefOf } from '../identity/identity.display.ts'
import { findProjects } from './projects.repository.ts'
import {
  findDailyActivity,
  findProjectItemCounts,
  findProjectRepositoriesForDashboard,
} from './projects.dashboard.repository.ts'

export const DASHBOARD_SOURCES = ['all', 'activity', 'code', 'pull_request'] as const
export type DashboardSource = (typeof DASHBOARD_SOURCES)[number]
const MAX_WINDOW_DAYS = 371
const MAX_REPOSITORIES = 20
const MAX_PAGES = 3
const PAGE_SIZE = 100

export interface DashboardGitCommit {
  committedAt: string
}
export interface DashboardGitPullRequest {
  createdAt: string
  state: string
  mergedAt: string | null
}

/** 晴雨表需要的只读 Git 能力；由 code 模块实现，projects 不感知适配器。 */
export interface DashboardGitReader {
  listCommits(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { page: number; pageSize: number },
  ): Promise<{ items: DashboardGitCommit[] }>
  listPullRequests(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { state: 'all' | 'open'; page: number; pageSize: number },
  ): Promise<{ items: DashboardGitPullRequest[] }>
}

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

export interface ProjectDashboardDeps {
  db: Database
  git: DashboardGitReader
}

function isSource(value: string): value is DashboardSource {
  return (DASHBOARD_SOURCES as readonly string[]).includes(value)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(value: string, name: string): Date {
  if (!DATE_PATTERN.test(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}格式必须为 YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不是有效日期`)
  return date
}

function dateOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** 判断字符串是否为项目状态。 */
function isProjectStatus(value: string): value is 'active' | 'paused' | 'ended' {
  return value === 'active' || value === 'paused' || value === 'ended'
}

/**
 * 创建项目首页晴雨表服务。
 * @param deps 数据库与 code 模块只读 Git 能力。
 * @returns 按团队聚合活动与项目摘要的用例。
 */
export function createProjectDashboardService(deps: ProjectDashboardDeps) {
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
    const today = new Date(`${dateOf(new Date())}T00:00:00.000Z`)
    const from = query.from ? parseDate(query.from, '开始日期') : addDays(today, -(MAX_WINDOW_DAYS - 1))
    const to = query.to ? parseDate(query.to, '结束日期') : today
    if (to.getTime() < from.getTime()) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '结束日期不能早于开始日期')
    if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_WINDOW_DAYS) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `日期窗口最多 ${MAX_WINDOW_DAYS} 天`)
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
    const [itemCounts, repoRows, activityRows] = await Promise.all([
      findProjectItemCounts(db, projectIds),
      findProjectRepositoriesForDashboard(db, projectIds),
      findDailyActivity(db, projectIds, from, addDays(to, 1)),
    ])
    const ownerRefs = await loadUserRefs(
      db,
      projectRows.map((row) => row.owner_user_id),
    )
    const sourceStatus = { activity: 'ok', code: 'unknown', pullRequest: 'unknown' } as {
      activity: string
      code: string
      pullRequest: string
    }
    const codeByDay = new Map<string, number>()
    const prByDay = new Map<string, number>()
    const pendingPrByProject = new Map<string, number>()
    const repositoriesByProject = new Map<string, Array<{ repositoryId: string }>>()
    for (const repo of repoRows.slice(0, MAX_REPOSITORIES)) {
      const list = repositoriesByProject.get(repo.projectId) ?? []
      list.push({ repositoryId: repo.repositoryId })
      repositoriesByProject.set(repo.projectId, list)
    }
    if (source === 'all' || source === 'code' || source === 'pull_request') {
      let codeOk = true
      let prOk = true
      for (const project of projectRows) {
        const repositories = repositoriesByProject.get(project.id) ?? []
        let openPrs = 0
        for (const repository of repositories) {
          try {
            if (source === 'all' || source === 'code') {
              for (let page = 1; page <= MAX_PAGES; page += 1) {
                const result = await deps.git.listCommits(actor, project.id, repository.repositoryId, {
                  page,
                  pageSize: PAGE_SIZE,
                })
                for (const commit of result.items) {
                  const date = commit.committedAt.slice(0, 10)
                  if (date >= dateOf(from) && date <= dateOf(to)) {
                    codeByDay.set(date, (codeByDay.get(date) ?? 0) + 1)
                  }
                }
                if (result.items.length < PAGE_SIZE) break
              }
            }
            if (source === 'all' || source === 'pull_request') {
              for (let page = 1; page <= MAX_PAGES; page += 1) {
                const result = await deps.git.listPullRequests(actor, project.id, repository.repositoryId, {
                  state: 'all',
                  page,
                  pageSize: PAGE_SIZE,
                })
                for (const pullRequest of result.items) {
                  if (pullRequest.state === 'open') openPrs += 1
                  const date = pullRequest.createdAt.slice(0, 10)
                  if (date >= dateOf(from) && date <= dateOf(to)) {
                    prByDay.set(date, (prByDay.get(date) ?? 0) + 1)
                  }
                }
                if (result.items.length < PAGE_SIZE) break
              }
            }
          } catch (error) {
            if (!(error instanceof ApiError)) throw error
            if (source === 'all' || source === 'code') codeOk = false
            if (source === 'all' || source === 'pull_request') prOk = false
          }
        }
        pendingPrByProject.set(project.id, openPrs)
      }
      sourceStatus.code = codeOk ? 'ok' : 'unknown'
      sourceStatus.pullRequest = prOk ? 'ok' : 'unknown'
    }
    const activityByDay = new Map<string, number>()
    for (const row of activityRows) {
      activityByDay.set(row.date, (activityByDay.get(row.date) ?? 0) + row.value)
    }
    const days: ProjectActivityDay[] = []
    for (let offset = 0; offset <= (to.getTime() - from.getTime()) / DAY_MS; offset += 1) {
      const date = dateOf(addDays(from, offset))
      const counts = {
        activity: source === 'code' || source === 'pull_request' ? 0 : (activityByDay.get(date) ?? 0),
        code: source === 'activity' || source === 'pull_request' ? 0 : (codeByDay.get(date) ?? 0),
        pullRequest: source === 'activity' || source === 'code' ? 0 : (prByDay.get(date) ?? 0),
      }
      const total =
        source === 'all'
          ? counts.activity + counts.code + counts.pullRequest
          : source === 'activity'
            ? counts.activity
            : source === 'code'
              ? counts.code
              : counts.pullRequest
      days.push({ date, total, counts })
    }
    return {
      timezone: 'UTC',
      from: dateOf(from),
      to: dateOf(to),
      source,
      sourceStatus,
      days,
      projects: projectRows.map((row) => {
        const item = itemCounts.get(row.id) ?? { total: 0, completed: 0, pendingRequirements: 0, pendingBugs: 0 }
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
          pendingPullRequests: sourceStatus.pullRequest === 'ok' ? (pendingPrByProject.get(row.id) ?? 0) : null,
          bots: null,
        }
      }),
    }
  }

  return { getProjectActivity }
}

export type ProjectDashboardService = ReturnType<typeof createProjectDashboardService>
