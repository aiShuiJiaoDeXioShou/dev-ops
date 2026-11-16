import { randomUUID } from 'node:crypto'
import { and, count, eq, exists, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { gitRepository, projectRepository } from '../code/code.tables.ts'
import { gitConnection } from '../integrations/integrations.tables.ts'
import type { Database } from '../../platform/database/client.ts'
import {
  projectDashboardDay,
  projectDashboardPullRequest,
  projectDashboardRepository,
} from './projects.dashboard.tables.ts'
import { project } from './projects.tables.ts'

const LEASE_MS = 2 * 60_000
const WRITE_BATCH_SIZE = 500

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Source = 'code' | 'pull_request'
type SyncState = typeof projectDashboardRepository.$inferSelect

export interface DashboardCommitUpdate {
  branch: string | null
  head: string | null
  replace: boolean
  days: ReadonlyMap<string, number>
}

export interface DashboardPullRequestFact {
  number: number
  openedOn: string
  updatedAt: Date
  isOpen: boolean
}

export interface DashboardPullRequestUpdate {
  replace: boolean
  items: DashboardPullRequestFact[]
}

/**
 * 领取一处到期仓库。行锁只用于领取，来源读取在事务外执行。
 * @param db Worker 数据库连接。
 * @param now 本轮领取时间。
 * @returns 由项目关联和有效连接授权的仓库及同步进度；无候选或被另一 Worker 领取时返回空值。
 * @remarks 租约到期后可重领；旧 Worker 的发布时间会再次校验租约令牌。
 */
export async function claimDashboardRepository(db: Database, now: Date) {
  const leaseToken = randomUUID()
  const nextSyncAt = new Date(now.getTime() + LEASE_MS)
  return db.transaction(async (tx) => {
    // PostgreSQL 的 FOR UPDATE OF 使用非限定表名，别名同时避免锁住外连接。
    const repository = alias(gitRepository, 'repository')
    const linkedProject = tx
      .select({ id: projectRepository.id })
      .from(projectRepository)
      .innerJoin(project, and(eq(project.id, projectRepository.project_id), eq(project.team_id, repository.team_id)))
      .where(and(eq(projectRepository.repository_id, repository.id), eq(projectRepository.team_id, repository.team_id)))
    const [candidate] = await tx
      .select({
        repositoryId: repository.id,
        namespace: repository.namespace,
        name: repository.name,
        branch: repository.default_branch,
        connection: {
          id: gitConnection.id,
          team_id: gitConnection.team_id,
          provider_key: gitConnection.provider_key,
          auth_kind: gitConnection.auth_kind,
          instance_url: gitConnection.instance_url,
          external_identity: gitConnection.external_identity,
          secret_id: gitConnection.secret_id,
        },
      })
      .from(repository)
      .innerJoin(
        gitConnection,
        and(eq(gitConnection.id, repository.connection_id), eq(gitConnection.team_id, repository.team_id)),
      )
      .leftJoin(projectDashboardRepository, eq(projectDashboardRepository.id, repository.id))
      .where(
        and(
          eq(repository.status, 'available'),
          eq(gitConnection.status, 'active'),
          eq(gitConnection.provider_key, repository.provider_key),
          exists(linkedProject),
          or(isNull(projectDashboardRepository.id), lte(projectDashboardRepository.next_sync_at, now)),
        ),
      )
      .orderBy(sql`${projectDashboardRepository.next_sync_at} nulls first`, repository.id)
      .limit(1)
      .for('update', { of: repository, skipLocked: true })
    if (!candidate) return null
    const [state] = await tx
      .insert(projectDashboardRepository)
      .values({ id: candidate.repositoryId, next_sync_at: nextSyncAt, lease_token: leaseToken, updated_at: now })
      .onConflictDoUpdate({
        target: projectDashboardRepository.id,
        set: { next_sync_at: nextSyncAt, lease_token: leaseToken, updated_at: now },
        setWhere: lte(projectDashboardRepository.next_sync_at, now),
      })
      .returning()
    return state ? { ...candidate, leaseToken, state } : null
  })
}

async function saveDays(
  tx: Transaction,
  repositoryId: string,
  source: Source,
  days: ReadonlyMap<string, number>,
  mode: 'add' | 'replace',
  now: Date,
) {
  if (days.size === 0) return
  const excludedCount = sql`excluded.activity_count`
  await tx
    .insert(projectDashboardDay)
    .values(
      [...days].map(([date, value]) => ({
        repository_id: repositoryId,
        source,
        activity_date: date,
        activity_count: value,
        updated_at: now,
      })),
    )
    .onConflictDoUpdate({
      target: [projectDashboardDay.repository_id, projectDashboardDay.source, projectDashboardDay.activity_date],
      set: {
        activity_count: mode === 'add' ? sql`${projectDashboardDay.activity_count} + ${excludedCount}` : excludedCount,
        updated_at: now,
      },
      setWhere: mode === 'replace' ? sql`${projectDashboardDay.activity_count} <> ${excludedCount}` : undefined,
    })
}

async function savePullRequests(
  tx: Transaction,
  repositoryId: string,
  update: DashboardPullRequestUpdate,
  from: string,
  now: Date,
): Promise<number> {
  const repoFilter = eq(projectDashboardPullRequest.repository_id, repositoryId)
  if (update.replace) await tx.delete(projectDashboardPullRequest).where(repoFilter)
  for (let offset = 0; offset < update.items.length; offset += WRITE_BATCH_SIZE) {
    const batch = update.items.slice(offset, offset + WRITE_BATCH_SIZE)
    await tx
      .insert(projectDashboardPullRequest)
      .values(
        batch.map((item) => ({
          repository_id: repositoryId,
          remote_number: item.number,
          opened_on: item.openedOn,
          remote_updated_at: item.updatedAt,
          is_open: item.isOpen,
          updated_at: now,
        })),
      )
      .onConflictDoUpdate({
        target: [projectDashboardPullRequest.repository_id, projectDashboardPullRequest.remote_number],
        set: { remote_updated_at: sql`excluded.remote_updated_at`, is_open: sql`excluded.is_open`, updated_at: now },
        setWhere: sql`excluded.remote_updated_at > ${projectDashboardPullRequest.remote_updated_at}
          or (excluded.remote_updated_at = ${projectDashboardPullRequest.remote_updated_at}
            and excluded.is_open <> ${projectDashboardPullRequest.is_open})`,
      })
  }
  await tx
    .delete(projectDashboardPullRequest)
    .where(
      and(repoFilter, eq(projectDashboardPullRequest.is_open, false), lt(projectDashboardPullRequest.opened_on, from)),
    )
  const affectedDays = [...new Set(update.items.map((item) => item.openedOn).filter((date) => date >= from))]
  if (affectedDays.length > 0) {
    const counts = await tx
      .select({ date: projectDashboardPullRequest.opened_on, value: count() })
      .from(projectDashboardPullRequest)
      .where(and(repoFilter, inArray(projectDashboardPullRequest.opened_on, affectedDays)))
      .groupBy(projectDashboardPullRequest.opened_on)
    await saveDays(
      tx,
      repositoryId,
      'pull_request',
      new Map(counts.map((row) => [row.date, row.value])),
      'replace',
      now,
    )
  }
  const [open] = await tx
    .select({ value: count() })
    .from(projectDashboardPullRequest)
    .where(and(repoFilter, eq(projectDashboardPullRequest.is_open, true)))
  return open?.value ?? 0
}

/**
 * 发布单个仓库本轮的日统计、PR 汇总和游标。
 * @param db Worker 数据库连接。
 * @param input 租约、UTC 覆盖起点、轮询时间与来源结果；失败来源传 null。
 * @returns 本轮结果是否提交；租约丢失时跳过。
 * @remarks 来源成功时一并提交统计与游标；失败时保留可重试的进度，同时停止展示该来源。
 */
export async function publishDashboardRepository(
  db: Database,
  input: {
    repositoryId: string
    leaseToken: string
    from: string
    checkedAt: Date
    publishedAt: Date
    nextSyncAt: Date
    code: DashboardCommitUpdate | null
    pullRequests: DashboardPullRequestUpdate | null
  },
): Promise<boolean> {
  const { repositoryId, leaseToken, from, checkedAt, publishedAt, nextSyncAt, code, pullRequests } = input
  return db.transaction(async (tx) => {
    const lease = and(
      eq(projectDashboardRepository.id, repositoryId),
      eq(projectDashboardRepository.lease_token, leaseToken),
    )
    const [claimed] = await tx
      .select({ id: projectDashboardRepository.id })
      .from(projectDashboardRepository)
      .where(lease)
      .for('update')
    if (!claimed) return false
    const update: Partial<SyncState> = {
      lease_token: null,
      next_sync_at: nextSyncAt,
      updated_at: publishedAt,
      commits_available: code !== null,
      pull_requests_available: pullRequests !== null,
    }
    for (const [source, result] of [
      ['code', code],
      ['pull_request', pullRequests],
    ] satisfies [Source, { replace: boolean } | null][]) {
      if (!result) continue
      await tx
        .delete(projectDashboardDay)
        .where(
          and(
            eq(projectDashboardDay.repository_id, repositoryId),
            eq(projectDashboardDay.source, source),
            result.replace ? undefined : lt(projectDashboardDay.activity_date, from),
          ),
        )
    }
    if (code) {
      await saveDays(tx, repositoryId, 'code', code.days, code.replace ? 'replace' : 'add', publishedAt)
      update.commit_branch = code.branch
      update.commit_head = code.head
      update.commit_from = from
      update.commit_checked_at = checkedAt
    }
    if (pullRequests) {
      update.open_pull_requests = await savePullRequests(tx, repositoryId, pullRequests, from, publishedAt)
      update.pull_request_from = from
      update.pull_request_checked_at = checkedAt
      if (pullRequests.replace) update.pull_request_reconciled_at = checkedAt
    }
    await tx.update(projectDashboardRepository).set(update).where(lease)
    return true
  })
}
