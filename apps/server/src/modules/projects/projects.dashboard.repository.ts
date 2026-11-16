import { and, count, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { activity } from '../collaboration/collaboration.tables.ts'
import { requirement } from '../requirements/requirements.tables.ts'
import { bug } from '../bugs/bugs.tables.ts'
import { gitRepository, projectRepository } from '../code/code.tables.ts'
import { secret } from '../configuration/configuration.tables.ts'
import { gitConnection } from '../integrations/integrations.tables.ts'
import { DASHBOARD_MAX_CACHE_AGE_MS } from './projects.dashboard.constants.ts'
import { projectDashboardDay, projectDashboardRepository } from './projects.dashboard.tables.ts'

export interface ProjectItemCounts {
  total: number
  completed: number
  pendingRequirements: number
  pendingBugs: number
}

/**
 * 加载首页可见仓库的日统计和未关闭 PR 数，使用同一数据库快照读取来源状态与统计。
 * @param db 数据库连接。
 * @param input 已授权团队、当前项目集合、UTC 窗口、展示来源与读取时间。
 * @returns 去重后的仓库日统计，以及按项目关联计算的 PR 数；未知来源不贡献计数。
 */
export async function readDashboardRepositoryActivity(
  db: Database,
  input: {
    teamId: string
    projectIds: string[]
    from: string
    to: string
    source: 'all' | 'code' | 'pull_request'
    now: Date
  },
) {
  const { teamId, projectIds, from, to, source, now } = input
  const result = {
    codeOk: true,
    pullRequestOk: true,
    codeByDay: new Map<string, number>(),
    pullRequestByDay: new Map<string, number>(),
    pendingByProject: new Map<string, number | null>(),
  }
  if (projectIds.length === 0) return result
  const checkedAfter = new Date(now.getTime() - DASHBOARD_MAX_CACHE_AGE_MS)
  return db.transaction(
    async (tx) => {
      const rows = await tx
        .select({
          projectId: projectRepository.project_id,
          repositoryId: projectRepository.repository_id,
          repositoryStatus: gitRepository.status,
          defaultBranch: gitRepository.default_branch,
          connectionStatus: gitConnection.status,
          secretId: gitConnection.secret_id,
          secretStatus: secret.status,
          commitBranch: projectDashboardRepository.commit_branch,
          commitFrom: projectDashboardRepository.commit_from,
          commitCheckedAt: projectDashboardRepository.commit_checked_at,
          commitsAvailable: projectDashboardRepository.commits_available,
          pullRequestFrom: projectDashboardRepository.pull_request_from,
          pullRequestCheckedAt: projectDashboardRepository.pull_request_checked_at,
          pullRequestsAvailable: projectDashboardRepository.pull_requests_available,
          openPullRequests: projectDashboardRepository.open_pull_requests,
        })
        .from(projectRepository)
        .leftJoin(
          gitRepository,
          and(eq(gitRepository.id, projectRepository.repository_id), eq(gitRepository.team_id, teamId)),
        )
        .leftJoin(
          gitConnection,
          and(
            eq(gitConnection.id, gitRepository.connection_id),
            eq(gitConnection.team_id, teamId),
            eq(gitConnection.provider_key, gitRepository.provider_key),
          ),
        )
        .leftJoin(secret, and(eq(secret.id, gitConnection.secret_id), eq(secret.team_id, teamId)))
        .leftJoin(projectDashboardRepository, eq(projectDashboardRepository.id, gitRepository.id))
        .where(and(eq(projectRepository.team_id, teamId), inArray(projectRepository.project_id, projectIds)))

      const codeRepos = new Set<string>()
      const pullRequestRepos = new Set<string>()
      for (const row of rows) {
        const { openPullRequests } = row
        const isAuthorized =
          row.repositoryStatus === 'available' &&
          row.connectionStatus === 'active' &&
          (row.secretId === null || row.secretStatus === 'active')
        const hasCode =
          isAuthorized &&
          row.commitsAvailable &&
          row.commitBranch === row.defaultBranch &&
          row.commitCheckedAt !== null &&
          row.commitCheckedAt >= checkedAfter
        const hasPullRequests =
          isAuthorized &&
          row.pullRequestsAvailable &&
          openPullRequests !== null &&
          row.pullRequestCheckedAt !== null &&
          row.pullRequestCheckedAt >= checkedAfter
        if (hasCode) codeRepos.add(row.repositoryId)
        if (hasPullRequests) pullRequestRepos.add(row.repositoryId)
        if (!hasCode || row.commitFrom === null || row.commitFrom > from) result.codeOk = false
        if (!hasPullRequests || row.pullRequestFrom === null || row.pullRequestFrom > from) result.pullRequestOk = false
        const pending = result.pendingByProject.get(row.projectId)
        result.pendingByProject.set(
          row.projectId,
          hasPullRequests && pending !== null ? (pending ?? 0) + openPullRequests : null,
        )
      }
      const scopes = []
      if (codeRepos.size > 0 && source !== 'pull_request') {
        scopes.push(
          and(eq(projectDashboardDay.source, 'code'), inArray(projectDashboardDay.repository_id, [...codeRepos])),
        )
      }
      if (pullRequestRepos.size > 0 && source !== 'code') {
        scopes.push(
          and(
            eq(projectDashboardDay.source, 'pull_request'),
            inArray(projectDashboardDay.repository_id, [...pullRequestRepos]),
          ),
        )
      }
      if (scopes.length === 0) return result
      const days = await tx
        .select({
          date: projectDashboardDay.activity_date,
          source: projectDashboardDay.source,
          value: sql<number>`sum(${projectDashboardDay.activity_count})`.mapWith(Number),
        })
        .from(projectDashboardDay)
        .where(
          and(or(...scopes), gte(projectDashboardDay.activity_date, from), lte(projectDashboardDay.activity_date, to)),
        )
        .groupBy(projectDashboardDay.activity_date, projectDashboardDay.source)
      for (const day of days) {
        if (day.source === 'code') result.codeByDay.set(day.date, day.value)
        else if (day.source === 'pull_request') result.pullRequestByDay.set(day.date, day.value)
        else throw new Error('数据库晴雨表活动来源不合法')
      }
      return result
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * 查询项目事项统计：完成度、未完成需求与 Bug。
 * @param db 数据库连接。
 * @param projectIds 项目标识集合。
 * @returns 项目 → 计数映射。
 */
export async function findProjectItemCounts(db: Database, projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, ProjectItemCounts>()
  const [requirementRows, bugRows] = await Promise.all([
    db
      .select({ projectId: requirement.project_id, status: requirement.status, value: count() })
      .from(requirement)
      .where(inArray(requirement.project_id, projectIds))
      .groupBy(requirement.project_id, requirement.status),
    db
      .select({ projectId: bug.project_id, status: bug.status, value: count() })
      .from(bug)
      .where(inArray(bug.project_id, projectIds))
      .groupBy(bug.project_id, bug.status),
  ])
  const result = new Map<string, ProjectItemCounts>()
  for (const projectId of projectIds) {
    result.set(projectId, { total: 0, completed: 0, pendingRequirements: 0, pendingBugs: 0 })
  }
  for (const row of requirementRows) {
    const item = result.get(row.projectId)
    if (!item) continue
    item.total += row.value
    if (row.status === 'passed') item.completed += row.value
    if (row.status !== 'passed' && row.status !== 'cancelled') item.pendingRequirements += row.value
  }
  for (const row of bugRows) {
    const item = result.get(row.projectId)
    if (!item) continue
    item.total += row.value
    if (row.status === 'resolved' || row.status === 'closed') item.completed += row.value
    if (row.status !== 'resolved' && row.status !== 'closed') item.pendingBugs += row.value
  }
  return result
}

export interface ActivityDayRow {
  projectId: string
  date: string
  value: number
}

/**
 * 按项目与 UTC 日期聚合事项活动数量。
 * @param db 数据库连接。
 * @param projectIds 项目标识。
 * @param from 窗口开始（UTC 日期）。
 * @param toExclusive 窗口结束次日（UTC 日期，不含）。
 * @returns 每日每项目活动数。
 */
export async function findDailyActivity(db: Database, projectIds: string[], from: Date, toExclusive: Date) {
  if (projectIds.length === 0) return []
  const dateExpr = sql<string>`to_char(${activity.created_at} at time zone 'UTC', 'YYYY-MM-DD')`
  const rows = await db
    .select({ projectId: activity.project_id, date: dateExpr, value: count() })
    .from(activity)
    .where(
      and(
        inArray(activity.project_id, projectIds),
        gte(activity.created_at, from),
        lt(activity.created_at, toExclusive),
        inArray(activity.entity_type, ['requirement', 'bug']),
      ),
    )
    .groupBy(activity.project_id, dateExpr)
  return rows.flatMap((row) => (row.projectId ? [{ projectId: row.projectId, date: row.date, value: row.value }] : []))
}
