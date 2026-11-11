import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Bug, Plus, Search, TriangleAlert } from 'lucide-react'
import { EmptyState } from '@/shared/ui/page-state'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { StatusBadge } from '@/shared/ui/status-badge'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { parseListState, toSearchParams, updateListState } from '@/shared/lib/list-state'
import { projectQueryOptions } from '@/features/projects/public'
import type { BugListStatus } from '../api/queries'
import { canWriteBugs } from '../api/mutations'
import { bugListQueryOptions } from '../api/queries'
import { BUG_STATUS_LABELS, bugStatusTone } from '../model/labels'
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
  if (query.isPending) return <DelayedPageSkeleton />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <div className="empty">
        <TriangleAlert className="size-5" aria-hidden="true" />
        <h3>Bug 列表加载失败</h3>
        <p>{described.description}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          重新加载
        </Button>
      </div>
    )
  }
  const items = query.data.data.items
  const isEmpty = items.length === 0
  const filtered = Boolean(state.search || state.status)
  return (
    <div className="row items-workspace">
      <div className="items-workspace-main">
        <div className="list-toolbar">
          <div className="filters">
            <Select
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
            </Select>
            <label className="search">
              <Search className="size-4" aria-hidden="true" />
              <Input
                className="search-input"
                aria-label="搜索 Bug"
                placeholder="搜索标题或编号"
                value={state.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </label>
          </div>
          {canWrite && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              新建 Bug
            </Button>
          )}
        </div>
        {isEmpty ? (
          <EmptyState
            mascot="signal"
            title={filtered ? '没有符合条件的 Bug' : '还没有 Bug'}
            description={
              filtered
                ? '当前搜索或状态筛选没有找到 Bug，可以清除筛选后重新查看。'
                : '创建第一条 Bug，把负责人、状态流转与协作记录放进同一个事项。'
            }
            action={
              filtered ? (
                <Button type="button" variant="outline" onClick={() => setParams(new URLSearchParams())}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table className="table">
            <TableHeader>
              <TableRow>
                <TableHead>事项</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>业务进度</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className={`clickable-row${state.openId === item.id ? ' selected' : ''}`}
                  onClick={(event) => {
                    if (isNestedInteractiveTarget(event.target)) return
                    update({ openId: item.id })
                  }}
                >
                  <TableCell>
                    <div className="item-cell">
                      <Bug className="size-4" aria-hidden="true" />
                      <Button
                        type="button"
                        variant="ghost"
                        className="item-title"
                        onClick={() => update({ openId: item.id })}
                      >
                        <span className="item-id">BUG-{item.number}</span>
                        {item.title}
                      </Button>
                      <span className="mobile-status">
                        <StatusBadge tone={bugStatusTone(item.status)}>
                          {BUG_STATUS_LABELS[item.status] ?? item.status}
                        </StatusBadge>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{item.fixOwner?.name ?? '未指定'}</TableCell>
                  <TableCell>
                    <StatusBadge tone={bugStatusTone(item.status)}>
                      {BUG_STATUS_LABELS[item.status] ?? item.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="quiet">{formatDateTime(item.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!isEmpty && (
          <div className="pagination">
            <span className="quiet">共 {query.data.data.total} 条</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={state.page <= 1}
              onClick={() => update({ page: state.page - 1 })}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={state.page * state.pageSize >= query.data.data.total}
              onClick={() => update({ page: state.page + 1 })}
            >
              下一页
            </Button>
          </div>
        )}
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
