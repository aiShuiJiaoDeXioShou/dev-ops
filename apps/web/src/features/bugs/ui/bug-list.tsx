import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { parseListState, toSearchParams, updateListState } from '@/shared/lib/list-state'
import { projectQueryOptions } from '@/features/projects/public'
import { canWriteBugs } from '../api/mutations'
import { bugListQueryOptions } from '../api/queries'
import { BUG_STATUS_LABELS, BUG_STATUS_OPTIONS } from '../model/labels'
import { BugDetailPane } from './bug-detail'
import { BugForm } from './bug-form'

/** 项目 Bug 列表与详情。 */
export function BugList({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  const [params, setParams] = useSearchParams()
  const state = parseListState(params, { statuses: Object.keys(BUG_STATUS_LABELS) })
  const query = useQuery(
    bugListQueryOptions(projectId, {
      search: state.search || undefined,
      status: (state.status || undefined) as import('../api/queries').BugListStatus | undefined,
      page: state.page,
      pageSize: state.pageSize,
    }),
  )
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = canWriteBugs(role)
  const update = (patch: Partial<typeof state>) => setParams(toSearchParams(updateListState(state, patch)))
  if (query.isPending) return <PageLoading />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="Bug 列表加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const items = query.data.data.items
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="搜索 Bug"
            placeholder="搜索标题或编号"
            className="w-48"
            value={state.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <Select
            aria-label="Bug 状态"
            value={state.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">全部状态</option>
            {BUG_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <span className="flex-1" />
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
            创建 Bug
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState
            title={state.search || state.status ? '没有匹配的 Bug' : '还没有 Bug'}
            description={
              state.search || state.status ? '调整搜索或状态筛选后重试。' : '创建第一条 Bug，记录现象、预期与复现信息。'
            }
          />
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>修复负责人</TableHead>
                  <TableHead>更新时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => update({ openId: item.id })}
                    aria-selected={state.openId === item.id}
                  >
                    <TableCell className="text-muted-foreground">#{item.number}</TableCell>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{BUG_STATUS_LABELS[item.status] ?? item.status}</Badge>
                    </TableCell>
                    <TableCell>{item.fixOwner?.name ?? '未指定'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(item.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {query.data.data.total} 条</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={state.page <= 1}
              onClick={() => update({ page: state.page - 1 })}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={state.page * state.pageSize >= query.data.data.total}
              onClick={() => update({ page: state.page + 1 })}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
      {state.openId ? (
        <BugDetailPane key={state.openId} bugId={state.openId} onClose={() => update({ openId: null })} />
      ) : (
        <aside className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          选择一条 Bug 查看详情、回归历史与流程动作。
        </aside>
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
