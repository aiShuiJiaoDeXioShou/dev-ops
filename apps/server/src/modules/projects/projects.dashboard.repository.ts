import { and, count, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { activity } from '../collaboration/collaboration.tables.ts'
import { requirement } from '../requirements/requirements.tables.ts'
import { bug } from '../bugs/bugs.tables.ts'
import { gitRepository, projectRepository } from '../code/code.tables.ts'

export interface ProjectItemCounts {
  total: number
  completed: number
  pendingRequirements: number
  pendingBugs: number
}

/** 读取项目仓库列表（含默认分支），供晴雨表来源读取。 */
export async function findProjectRepositoriesForDashboard(db: Database, projectIds: string[]) {
  if (projectIds.length === 0) return []
  return db
    .select({
      projectId: projectRepository.project_id,
      repositoryId: gitRepository.id,
      defaultBranch: gitRepository.default_branch,
      status: gitRepository.status,
    })
    .from(projectRepository)
    .innerJoin(gitRepository, eq(gitRepository.id, projectRepository.repository_id))
    .where(inArray(projectRepository.project_id, projectIds))
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
