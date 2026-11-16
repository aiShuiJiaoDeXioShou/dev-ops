import {
  gitAdapterErrorCode,
  type GitReadPort,
  type GitCommitSummaryPort,
  type GitPullRequestSummaryPort,
  type PullRequestStateFilter,
} from '../code/code.service.ts'
import type { Database } from '../../platform/database/client.ts'
import { DASHBOARD_DAY_MS, DASHBOARD_SYNC_INTERVAL_MS, DASHBOARD_WINDOW_DAYS } from './projects.dashboard.constants.ts'
import {
  claimDashboardRepository,
  publishDashboardRepository,
  type DashboardCommitUpdate,
  type DashboardPullRequestFact,
  type DashboardPullRequestUpdate,
} from './projects.dashboard-sync.repository.ts'

const PAGE_SIZE = 50
const MAX_PAGES = 80
const SYNC_BUDGET_MS = 60_000
const PR_OVERLAP_MS = 2 * DASHBOARD_SYNC_INTERVAL_MS
const FULL_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

type ClaimedRepository = NonNullable<Awaited<ReturnType<typeof claimDashboardRepository>>>
type DashboardGitReader = Pick<GitReadPort, 'listCommits' | 'listFastForwardCommits' | 'listPullRequests'>

interface SyncContext {
  candidate: ClaimedRepository
  adapter: DashboardGitReader
  from: string
  since: Date
  checkedAt: Date
  signal: AbortSignal
}

function dateOf(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function countCommits(items: Iterable<GitCommitSummaryPort>, from: string): Map<string, number> {
  const days = new Map<string, number>()
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.sha)) continue
    seen.add(item.sha)
    const day = dateOf(new Date(item.committedAt))
    if (day >= from) days.set(day, (days.get(day) ?? 0) + 1)
  }
  return days
}

async function readCommitUpdate(context: SyncContext): Promise<DashboardCommitUpdate> {
  const { candidate, adapter, since, from, signal } = context
  const { branch, state } = candidate
  const empty = { branch, head: null, replace: true, days: new Map<string, number>() }
  if (!branch) return empty
  if (!adapter.listCommits) throw new Error('来源无法读取提交列表')
  signal.throwIfAborted()
  const [latest] = await adapter.listCommits({ repository: candidate, ref: branch, page: 1, pageSize: 1 })
  if (!latest) return empty
  const head = latest.sha
  if (!FULL_COMMIT_ID.test(head)) throw new Error('来源未返回完整提交标识')
  const hasBaseline = state.commit_branch === branch && state.commit_from !== null && state.commit_from <= from
  if (hasBaseline && state.commit_head === head) return { ...empty, head, replace: false }
  if (hasBaseline && state.commit_head && adapter.listFastForwardCommits) {
    signal.throwIfAborted()
    try {
      const added = await adapter.listFastForwardCommits({ repository: candidate, base: state.commit_head, head })
      if (added !== null) return { branch, head, replace: false, days: countCommits(added, from) }
    } catch (error) {
      // 强推后旧提交可能已不可访问，或旧来源不支持完整比较；此时用新分支头重建。
      const code = gitAdapterErrorCode(error)
      if (code !== 'not_found' && code !== 'unsupported' && code !== 'invalid_response') {
        throw error
      }
    }
  }

  const commits: GitCommitSummaryPort[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    signal.throwIfAborted()
    const rows = await adapter.listCommits({
      repository: candidate,
      ref: head,
      since: since.toISOString(),
      page,
      pageSize: PAGE_SIZE,
    })
    if (rows.length === 0) return { branch, head, replace: true, days: countCommits(commits, from) }
    commits.push(...rows)
  }
  throw new Error('仓库提交回填达到分页上限')
}

function pullRequestFact(item: GitPullRequestSummaryPort): DashboardPullRequestFact {
  if (item.state === 'unknown') throw new Error('来源未返回有效 PR 状态')
  if (!Number.isSafeInteger(item.number) || item.number < 1) {
    throw new Error('来源未返回有效 PR 编号')
  }
  return {
    number: item.number,
    openedOn: dateOf(new Date(item.createdAt)),
    updatedAt: new Date(item.updatedAt),
    isOpen: item.state === 'open',
  }
}

function saveFact(facts: Map<number, DashboardPullRequestFact>, fact: DashboardPullRequestFact, from: string) {
  const previous = facts.get(fact.number)
  if (previous && previous.updatedAt > fact.updatedAt) return
  if (fact.isOpen || fact.openedOn >= from || previous) facts.set(fact.number, fact)
}

async function readPullRequestPages(
  context: SyncContext,
  state: PullRequestStateFilter,
  cutoff: Date | null,
  add: (fact: DashboardPullRequestFact) => void,
): Promise<boolean> {
  const { adapter, candidate, signal } = context
  if (!adapter.listPullRequests) throw new Error('来源无法读取 PR 列表')
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    signal.throwIfAborted()
    const rows = await adapter.listPullRequests({
      repository: candidate,
      state,
      sort: 'updated',
      page,
      pageSize: PAGE_SIZE,
    })
    if (rows.length === 0) return true
    const facts = rows.map(pullRequestFact)
    for (const fact of facts) {
      if (Number.isNaN(fact.updatedAt.getTime())) throw new Error('PR 更新时间不合法')
      add(fact)
    }
    if (cutoff !== null && facts.every((fact) => fact.updatedAt < cutoff)) return false
  }
  throw new Error('仓库 PR 同步达到分页上限')
}

async function readPullRequestUpdate(context: SyncContext): Promise<DashboardPullRequestUpdate> {
  const { candidate, checkedAt, from, since } = context
  const lastSync = candidate.state.pull_request_checked_at
  const lastReconcile = candidate.state.pull_request_reconciled_at
  const previousFrom = candidate.state.pull_request_from
  const replace =
    !lastSync ||
    !lastReconcile ||
    !previousFrom ||
    previousFrom > from ||
    checkedAt.getTime() - lastReconcile.getTime() >= DASHBOARD_DAY_MS
  const cutoff = !replace && lastSync ? new Date(lastSync.getTime() - PR_OVERLAP_MS) : since
  const facts = new Map<number, DashboardPullRequestFact>()
  const allFetched = await readPullRequestPages(context, 'all', cutoff, (fact) => {
    // 增量也必须保留旧 PR 的关闭记录，用于扣除之前同步的 open 数。
    if (replace) saveFact(facts, fact, from)
    else if (fact.updatedAt >= cutoff && !facts.has(fact.number)) facts.set(fact.number, fact)
  })
  // 窗口之外仍然打开的 PR 也计入项目卡片。全量回读负责纠正删除、漏页或时间游标偏差。
  if (replace && !allFetched) await readPullRequestPages(context, 'open', null, (fact) => saveFact(facts, fact, from))
  return { replace, items: [...facts.values()] }
}

/**
 * 创建晴雨表后台增量同步器。每轮至多领取一个仓库，来源 I/O 全部在数据库事务之外。
 * @param deps 数据库、Git 连接工厂、安全日志与可选时钟。
 * @returns 执行一轮的函数，无候选时直接返回；数据库异常向上抛出。
 */
export function createProjectDashboardSync(deps: {
  db: Database
  resolveAdapter: (connection: ClaimedRepository['connection']) => Promise<DashboardGitReader>
  log: (message: string, context: Record<string, unknown>) => void
  now?: () => Date
}) {
  const now = deps.now ?? (() => new Date())
  return async function runOnce(shutdown: AbortSignal): Promise<void> {
    if (shutdown.aborted) return
    const checkedAt = now()
    const candidate = await claimDashboardRepository(deps.db, checkedAt)
    if (!candidate) return
    const today = dateOf(checkedAt)
    const start = new Date(`${today}T00:00:00.000Z`).getTime() - (DASHBOARD_WINDOW_DAYS - 1) * DASHBOARD_DAY_MS
    // 来源端有的使用严格大于，提前一秒可覆盖窗口起点整秒的提交。
    const since = new Date(start - 1000)
    const from = dateOf(new Date(start))
    const logFailure = (source: string, error: unknown) => {
      deps.log('晴雨表来源同步失败', {
        repositoryId: candidate.repositoryId,
        source,
        errorCode: gitAdapterErrorCode(error) ?? (error instanceof Error ? error.name : typeof error),
      })
    }
    const signal = AbortSignal.any([shutdown, AbortSignal.timeout(SYNC_BUDGET_MS)])
    let code: DashboardCommitUpdate | null = null
    let pullRequests: DashboardPullRequestUpdate | null = null
    try {
      const adapter = await deps.resolveAdapter(candidate.connection)
      const context = { candidate, adapter, since, from, checkedAt, signal }
      // 两类来源独立收口，一个仓库的权限或分页限制只影响对应的统计。
      const settled = await Promise.allSettled([readCommitUpdate(context), readPullRequestUpdate(context)])
      if (settled[0].status === 'fulfilled') code = settled[0].value
      else if (!shutdown.aborted) logFailure('code', settled[0].reason)
      if (settled[1].status === 'fulfilled') pullRequests = settled[1].value
      else if (!shutdown.aborted) logFailure('pull_request', settled[1].reason)
    } catch (error) {
      if (!shutdown.aborted) logFailure('connection', error)
    }
    if (shutdown.aborted) return
    const publishedAt = now()
    await publishDashboardRepository(deps.db, {
      repositoryId: candidate.repositoryId,
      leaseToken: candidate.leaseToken,
      checkedAt,
      from,
      publishedAt,
      nextSyncAt: new Date(publishedAt.getTime() + DASHBOARD_SYNC_INTERVAL_MS),
      code,
      pullRequests,
    })
  }
}
