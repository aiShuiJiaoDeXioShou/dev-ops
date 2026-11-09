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
import { canWriteRequirements } from '../api/mutations'
import { requirementListQueryOptions } from '../api/queries'
import { REQUIREMENT_STATUS_LABELS, REQUIREMENT_STATUS_OPTIONS } from '../model/labels'
import { RequirementDetailPane } from './requirement-detail'
import { RequirementForm } from './requirement-form'

/** 项目需求列表与右侧详情。 */
export function RequirementList({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  const [params, setParams] = useSearchParams()
  const state = parseListState(params, {
    defaultPageSize: 20,
    statuses: Object.keys(REQUIREMENT_STATUS_LABELS),
  })
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
  const selectedId = state.openId
  if (query.isPending) return <PageLoading />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="需求列表加载失败"
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
            aria-label="搜索需求"
            placeholder="搜索标题或编号"
            className="w-48"
            value={state.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <Select
            aria-label="需求状态"
            value={state.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">全部状态</option>
            {REQUIREMENT_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <span className="flex-1" />
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
            创建需求
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState
            title={state.search || state.status ? '没有匹配的需求' : '还没有需求'}
            description={
              state.search || state.status
                ? '调整搜索或状态筛选后重试。'
                : '创建第一条需求，开始记录范围、负责人和验收标准。'
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
                  <TableHead>研发负责人</TableHead>
                  <TableHead>更新时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => update({ openId: item.id })}
                    aria-selected={selectedId === item.id}
                  >
                    <TableCell className="text-muted-foreground">#{item.number}</TableCell>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{REQUIREMENT_STATUS_LABELS[item.status] ?? item.status}</Badge>
                    </TableCell>
                    <TableCell>{item.devOwner?.name ?? '未指定'}</TableCell>
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
      {selectedId ? (
        <RequirementDetailPane key={selectedId} requirementId={selectedId} onClose={() => update({ openId: null })} />
      ) : (
        <aside className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          选择一条需求查看详情、评论与流程动作。
        </aside>
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
