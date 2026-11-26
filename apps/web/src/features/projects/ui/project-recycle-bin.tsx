import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { CompactListSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { ProjectLifecycleAction } from './project-lifecycle-action'

const statuses = {
  none: '尚未清理',
  queued: '等待清理',
  running: '正在清理',
  succeeded: '文件已清理',
  failed: '清理失败，可重试',
} as const

/**
 * 团队管理员的项目回收站，提供分页、恢复与项目文件清理。
 * @param props.teamId 当前团队标识。
 * @returns 回收站入口与弹窗。
 */
export function ProjectRecycleBin({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const title = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['projects', 'recycle-bin', teamId, page],
    queryFn: ({ signal }) => apiClient.listProjectRecycleBin(teamId, { page }, { signal }),
    enabled: open,
    refetchInterval: ({ state }) =>
      state.data?.data.items.some((item) => item.cleanupStatus === 'queued' || item.cleanupStatus === 'running')
        ? 2_000
        : false,
  })
  const data = query.data?.data
  const moveFocus = () => title.current?.focus()
  const refresh = (restored: boolean) => {
    if (restored && page > 1 && data?.items.length === 1) setPage(page - 1)
    void client.invalidateQueries({ queryKey: ['projects'] })
    if (restored) {
      for (const domain of ['requirements', 'bugs', 'pipeline', 'operations']) {
        void client.invalidateQueries({ queryKey: [domain] })
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPage(1)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button ref={trigger} type="button" variant="outline">
          回收站
        </Button>
      </DialogTrigger>
      <DialogContent
        layout="form"
        className="dialog-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          moveFocus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogFormHeader>
          <DialogTitle ref={title} tabIndex={-1}>
            项目回收站
          </DialogTitle>
          <DialogDescription>恢复项目可重新访问业务记录。已经清理的文件仍不可用。</DialogDescription>
        </DialogFormHeader>
        <DialogFormBody>
          {query.isPending ? (
            <CompactListSkeleton rows={4} trailing bordered label="回收站加载中" />
          ) : query.isError ? (
            <PageError
              title="回收站加载失败"
              description={describeRequestError(query.error).description}
              onRetry={() => void query.refetch()}
            />
          ) : data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">回收站没有项目。</p>
          ) : (
            <ul className="divide-y divide-border">
              {data?.items.map((item) => {
                const running = item.cleanupStatus === 'queued' || item.cleanupStatus === 'running'
                return (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1 wrap-anywhere">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">项目 ID {item.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.deletedAt)} · {statuses[item.cleanupStatus]}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ProjectLifecycleAction
                        project={item}
                        action="restore"
                        disabled={running}
                        onDone={() => refresh(true)}
                        focusAfterSuccess={moveFocus}
                      />
                      {item.cleanupStatus !== 'succeeded' && (
                        <ProjectLifecycleAction
                          project={item}
                          action="cleanup"
                          disabled={running}
                          label={item.cleanupStatus === 'failed' ? '重试清理' : undefined}
                          onDone={() => refresh(false)}
                          focusAfterSuccess={moveFocus}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {data && data.total > data.pageSize && (
            <div className="pagination">
              <Button type="button" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <span className="quiet">第 {page} 页</span>
              <Button
                type="button"
                variant="outline"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </DialogFormBody>
      </DialogContent>
    </Dialog>
  )
}
