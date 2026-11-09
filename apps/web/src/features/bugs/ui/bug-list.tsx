import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { EmptyState } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { parseListState, toSearchParams, updateListState } from '@/shared/lib/list-state'
import { projectQueryOptions } from '@/features/projects/public'
import type { BugListStatus } from '../api/queries'
import { canWriteBugs } from '../api/mutations'
import { bugListQueryOptions } from '../api/queries'
import { BUG_STATUS_LABELS } from '../model/labels'
import { BugDetailPane } from './bug-detail'
import { BugForm } from './bug-form'

/** 项目 Bug 列表与右侧详情；结构与事项页一致。 */
export function BugList({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  const [params, setParams] = useSearchParams()
  const state = parseListState(params, { statuses: Object.keys(BUG_STATUS_LABELS) })
  const query = useQuery(
    bugListQueryOptions(projectId, {
      search: state.search || undefined,
      status: (state.status || undefined) as BugListStatus | undefined,
      page: state.page,
      pageSize: state.pageSize,
    }),
  )
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = canWriteBugs(role)
  const update = (patch: Partial<typeof state>) => setParams(toSearchParams(updateListState(state, patch)))
  if (query.isPending) return <PageSkeleton />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <div className="empty">
        <PrototypeIcon name="warning" />
        <h3>Bug 列表加载失败</h3>
        <p>{described.description}</p>
        <button type="button" className="btn" onClick={() => void query.refetch()}>
          重新加载
        </button>
      </div>
    )
  }
  const items = query.data.data.items
  return (
    <div className="row items-workspace" style={{ alignItems: 'flex-start', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="section-heading">
          <h2>项目 Bug</h2>
          <span className="counter">{query.data.data.total}</span>
        </div>
        <div className="filters">
          <select
            className="filter-select"
            aria-label="Bug 状态"
            value={state.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(BUG_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="search">
            <PrototypeIcon name="search" />
            <input
              aria-label="搜索 Bug"
              placeholder="搜索标题或编号"
              value={state.search}
              onChange={(event) => update({ search: event.target.value })}
            />
          </label>
          <button type="button" className="btn primary" disabled={!canWrite} onClick={() => setCreateOpen(true)}>
            <PrototypeIcon name="plus" />
            新建 Bug
          </button>
        </div>
        {items.length === 0 ? (
          <EmptyState
            mascot={state.search || state.status ? undefined : 'signal'}
            icon={state.search || state.status ? <SearchX /> : undefined}
            title={state.search || state.status ? '没有符合条件的Bug' : '还没有Bug'}
            description={
              state.search || state.status
                ? '当前搜索或状态筛选没有找到Bug，可以清除筛选后重新查看。'
                : '创建第一条Bug，把负责人、状态流转与协作记录放进同一个事项。'
            }
            action={
              canWrite && !state.search && !state.status ? (
                <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                  新建Bug
                </button>
              ) : state.search || state.status ? (
                <button type="button" className="btn" onClick={() => setParams(new URLSearchParams())}>
                  清除筛选
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>事项</th>
                  <th>负责人</th>
                  <th>业务进度</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={state.openId === item.id ? 'selected' : undefined}>
                    <td>
                      <div className="item-cell">
                        <PrototypeIcon name="bug" />
                        <button type="button" className="item-title" onClick={() => update({ openId: item.id })}>
                          <span className="item-id">BUG-{item.number}</span>
                          {item.title}
                        </button>
                      </div>
                    </td>
                    <td>{item.fixOwner?.name ?? '未指定'}</td>
                    <td>
                      <span className="badge">{BUG_STATUS_LABELS[item.status] ?? item.status}</span>
                    </td>
                    <td className="quiet">{formatDateTime(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span className="quiet">共 {query.data.data.total} 条</span>
          <button
            type="button"
            className="btn"
            disabled={state.page <= 1}
            onClick={() => update({ page: state.page - 1 })}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn"
            disabled={state.page * state.pageSize >= query.data.data.total}
            onClick={() => update({ page: state.page + 1 })}
          >
            下一页
          </button>
        </div>
      </div>
      {state.openId && (
        <BugDetailPane key={state.openId} bugId={state.openId} onClose={() => update({ openId: null })} />
      )}
      {project.data?.data && (
        <BugForm
          projectId={projectId}
          teamId={project.data.data.teamId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={(id) => update({ openId: id })}
        />
      )}
    </div>
  )
}
