import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { FileText, Plus, Search, TriangleAlert } from 'lucide-react'
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
import { canWriteRequirements } from '../api/mutations'
import { requirementListQueryOptions } from '../api/queries'
import { REQUIREMENT_STATUS_LABELS, requirementStatusTone } from '../model/labels'
import { RequirementDetailPane } from './requirement-detail'
import { RequirementForm } from './requirement-form'

/** 项目需求列表与右侧详情；结构与事项页一致。 */
export function RequirementList({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  const [params, setParams] = useSearchParams()
  const state = parseListState(params, { statuses: Object.keys(REQUIREMENT_STATUS_LABELS) })
  const query = useQuery(
    requirementListQueryOptions(projectId, {
      search: state.search || undefined,
      status: (state.status || undefined) as import('../api/queries').RequirementListStatus | undefined,
      page: state.page,
      pageSize: state.pageSize,
    }),
  )
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = canWriteRequirements(role)
  const update = (patch: Partial<typeof state>) => setParams(toSearchParams(updateListState(state, patch)))
  if (query.isPending) return <DelayedPageSkeleton />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <div className="empty">
        <TriangleAlert className="size-5" aria-hidden="true" />
        <h3>需求列表加载失败</h3>
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
              aria-label="需求状态"
              value={state.status}
              onChange={(event) => update({ status: event.target.value })}
            >
              <option value="">全部状态</option>
              {Object.entries(REQUIREMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <label className="search">
              <Search className="size-4" aria-hidden="true" />
              <Input
                className="search-input"
                aria-label="搜索需求"
                placeholder="搜索标题或编号"
                value={state.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </label>
          </div>
          {canWrite && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              新建需求
            </Button>
          )}
        </div>
        {isEmpty ? (
          <EmptyState
            mascot="prism"
            title={filtered ? '没有符合条件的需求' : '还没有需求'}
            description={
              filtered
                ? '当前搜索或状态筛选没有找到需求，可以清除筛选后重新查看。'
                : '创建第一条需求，把负责人、状态流转与协作记录放进同一个事项。'
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
                      <FileText className="size-4" aria-hidden="true" />
                      <Button
                        type="button"
                        variant="ghost"
                        className="item-title"
                        onClick={() => update({ openId: item.id })}
                      >
                        <span className="item-id">#{item.number}</span>
                        <span className="item-title-text">{item.title}</span>
                      </Button>
                      <span className="mobile-status">
                        <StatusBadge tone={requirementStatusTone(item.status)}>
                          {REQUIREMENT_STATUS_LABELS[item.status] ?? item.status}
                        </StatusBadge>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{item.devOwner?.name ?? '未指定'}</TableCell>
                  <TableCell>
                    <StatusBadge tone={requirementStatusTone(item.status)}>
                      {REQUIREMENT_STATUS_LABELS[item.status] ?? item.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="quiet">{formatDateTime(item.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!isEmpty && query.data.data.total > query.data.data.pageSize && (
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
        {!isEmpty && query.data.data.total <= query.data.data.pageSize && (
          <p className="list-count">共 {query.data.data.total} 条</p>
        )}
      </div>
      {state.openId && (
        <RequirementDetailPane
          key={state.openId}
          requirementId={state.openId}
          onClose={() => update({ openId: null })}
        />
      )}
      {project.data?.data && (
        <RequirementForm
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
