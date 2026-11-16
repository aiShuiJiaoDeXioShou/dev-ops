import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RequestError } from '@dev-ops/api-client'
import { ChevronRight, Link2 } from 'lucide-react'
import { Link } from 'react-router'
import { bugQueryOptions } from '@/features/bugs/api/queries'
import { BUG_STATUS_LABELS, bugStatusTone } from '@/features/bugs/model/labels'
import { requirementQueryOptions } from '@/features/requirements/api/queries'
import { REQUIREMENT_STATUS_LABELS, requirementStatusTone } from '@/features/requirements/model/labels'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useToast } from '@/shared/ui/toast'

type WorkItemKind = 'bug' | 'requirement'
type WorkItem = { id: string; number: number; title: string; status: string }
type Source = { id: string; projectId: string } & ({ kind: 'bug'; version: number } | { kind: 'requirement' })
type LinkInput = { bugId: string; requirementId: string; version: number }
type CandidatePage = { items: Array<WorkItem & { version: number }>; total: number; pageSize: number }

const PAGE_SIZE = 20
const SEARCH_DELAY_MS = 250
// 弹窗的全局按钮最小宽度用于底部主操作。候选项和分页按钮按内容定宽。
const COMPACT_DIALOG_BUTTON = 'min-w-0! px-3!'

function workItemNumber(kind: WorkItemKind, number: number) {
  return kind === 'bug' ? `BUG-${number}` : `#${number}`
}

function workItemStatusLabel(kind: WorkItemKind, status: string) {
  const labels = kind === 'bug' ? BUG_STATUS_LABELS : REQUIREMENT_STATUS_LABELS
  return labels[status] ?? status
}

function WorkItemLabel({ kind, item }: { kind: WorkItemKind; item: WorkItem }) {
  const tone = kind === 'bug' ? bugStatusTone(item.status) : requirementStatusTone(item.status)
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{workItemNumber(kind, item.number)}</span>
      <span className="min-w-0 flex-1 text-sm wrap-anywhere">{item.title}</span>
      <StatusBadge tone={tone}>{workItemStatusLabel(kind, item.status)}</StatusBadge>
    </div>
  )
}

function LinkWorkItemDialog({
  source,
  kind,
  items,
  trigger,
  onClose,
}: {
  source: Source
  kind: WorkItemKind
  items: readonly WorkItem[]
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const { projectId } = source
  const target = kind === 'bug' ? ' Bug' : '需求'
  const inputId = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [input, setInput] = useState('')
  const [filters, setFilters] = useState({ search: '', page: 1 })
  // 支持粘贴列表里显示的 #编号或 BUG-编号，普通标题原样交给服务端搜索。
  const term = input.trim().replace(/^(?:BUG-|#)\s*(?=\d+$)/i, '')
  useEffect(() => {
    if (term === filters.search) return
    const timer = window.setTimeout(() => setFilters({ search: term, page: 1 }), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [term, filters.search])

  const candidateKey = ['collaboration', 'link-candidates', projectId, kind]
  const candidates = useQuery<CandidatePage>({
    queryKey: [...candidateKey, filters],
    queryFn: async ({ signal }) => {
      const query = { ...filters, pageSize: PAGE_SIZE }
      const response =
        kind === 'bug'
          ? await apiClient.listBugs(projectId, query, { signal })
          : await apiClient.listRequirements(projectId, query, { signal })
      return response.data
    },
  })
  const refreshRequirement = (requirementId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: requirementQueryOptions(requirementId).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['requirements', 'list', projectId] }),
    ])
  const link = useMutation({
    mutationFn: ({ bugId, requirementId, version }: LinkInput) =>
      apiClient.linkBugRequirement(bugId, { requirementId, version }),
    onSuccess: async (response, relation) => {
      queryClient.setQueryData(bugQueryOptions(relation.bugId).queryKey, response)
      await Promise.all([
        refreshRequirement(relation.requirementId),
        queryClient.invalidateQueries({ queryKey: ['collaboration', 'activities', 'bug', relation.bugId] }),
      ])
      showToast(`已关联${target}。`, 'success')
      onClose()
    },
    onError: async (cause, relation) => {
      if (!(cause instanceof RequestError)) return
      if (cause.serverCode !== 'VERSION_CONFLICT' && cause.serverCode !== 'DUPLICATE_RELATION') return
      // 版本冲突和并发重复关联都需要刷新，才能以当前版本重试或标记已关联。
      await Promise.all([
        refreshRequirement(relation.requirementId),
        queryClient.invalidateQueries({ queryKey: bugQueryOptions(relation.bugId).queryKey }),
        queryClient.invalidateQueries({ queryKey: candidateKey }),
      ])
    },
  })
  const linkedIds = new Set(items.map((item) => item.id))
  const isSearching = filters.search !== term || candidates.isFetching || candidates.isPending
  const page = candidates.data
  const totalPages = page ? Math.ceil(page.total / page.pageSize) : 0
  const changePage = (page: number) => {
    link.reset()
    setFilters({ ...filters, page })
  }

  let results: ReactNode
  if (isSearching) {
    results = (
      <p role="status" className="py-3 text-sm text-muted-foreground">
        正在查找{target}…
      </p>
    )
  } else if (candidates.isError) {
    results = (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {describeRequestError(candidates.error).description}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void candidates.refetch()}>
          重试
        </Button>
      </div>
    )
  } else if (!page?.items.length) {
    results = (
      <p role="status" className="py-3 text-sm text-muted-foreground">
        {term ? `没有找到匹配的${target}。` : `当前项目还没有${target}。`}
      </p>
    )
  } else {
    results = (
      <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`可关联的${target}`}>
        {page.items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
            <WorkItemLabel kind={kind} item={item} />
            {linkedIds.has(item.id) ? (
              <span className="shrink-0 text-xs text-muted-foreground">已关联</span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={COMPACT_DIALOG_BUTTON}
                aria-label={`关联 ${workItemNumber(kind, item.number)} ${item.title}`}
                disabled={link.isPending}
                onClick={() =>
                  link.mutate(
                    source.kind === 'bug'
                      ? { bugId: source.id, requirementId: item.id, version: source.version }
                      : { bugId: item.id, requirementId: source.id, version: item.version },
                  )
                }
              >
                关联
              </Button>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <DialogContent
      layout="form"
      className="gap-0! p-0!"
      showCloseButton={false}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        trigger.current?.focus({ preventScroll: true })
      }}
      onEscapeKeyDown={(event) => {
        if (link.isPending) event.preventDefault()
      }}
      onPointerDownOutside={(event) => {
        if (link.isPending) event.preventDefault()
      }}
    >
      <DialogFormHeader>
        <DialogTitle>关联已有{target}</DialogTitle>
        <DialogDescription>在当前项目中选择要关联的{target}。</DialogDescription>
      </DialogFormHeader>
      <div className="shrink-0 px-4 pt-4 sm:px-6">
        <FormField label={`搜索${target}`} htmlFor={inputId}>
          <Input
            id={inputId}
            type="search"
            placeholder="输入编号或标题"
            maxLength={200}
            value={input}
            disabled={link.isPending}
            onChange={(event) => {
              link.reset()
              setInput(event.target.value)
            }}
          />
        </FormField>
      </div>
      <DialogFormBody className="space-y-3">
        {link.error && (
          <p role="alert" className="text-sm text-destructive">
            {describeRequestError(link.error).description}
          </p>
        )}
        {link.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            正在关联…
          </p>
        )}
        {results}
      </DialogFormBody>
      <DialogFormFooter>
        {totalPages > 1 && (
          <div className="mr-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={COMPACT_DIALOG_BUTTON}
              disabled={isSearching || link.isPending || filters.page <= 1}
              onClick={() => changePage(filters.page - 1)}
            >
              上一页
            </Button>
            <span className="text-xs text-muted-foreground">
              {filters.page} / {totalPages} 页
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={COMPACT_DIALOG_BUTTON}
              disabled={isSearching || link.isPending || filters.page >= totalPages}
              onClick={() => changePage(filters.page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
        <DialogClose asChild>
          <Button type="button" variant="outline" className="pointer-coarse:min-h-11" disabled={link.isPending}>
            取消
          </Button>
        </DialogClose>
      </DialogFormFooter>
    </DialogContent>
  )
}

/**
 * 展示当前事项的关联列表，允许有写权限的成员从同一项目关联已有事项。
 * @param props 当前事项、对端摘要与写权限。
 * @returns 指向对端详情的链接和按需打开的搜索弹窗。
 */
export function WorkItemLinks({
  source,
  items,
  canWrite,
}: {
  source: Source
  items: readonly WorkItem[]
  canWrite: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const kind = source.kind === 'bug' ? 'requirement' : 'bug'
  const target = kind === 'bug' ? ' Bug' : '需求'
  const path = `/projects/${source.projectId}/${kind === 'bug' ? 'bugs' : 'requirements'}`
  return (
    <section className="space-y-2" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          关联{target}
        </h3>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button ref={trigger} type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11">
                <Link2 className="size-4" aria-hidden="true" />
                关联已有{target}
              </Button>
            </DialogTrigger>
            {open && (
              <LinkWorkItemDialog
                source={source}
                kind={kind}
                items={items}
                trigger={trigger}
                onClose={() => setOpen(false)}
              />
            )}
          </Dialog>
        )}
      </div>
      {items.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`关联${target}列表`}>
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`${path}?openId=${encodeURIComponent(item.id)}`}
                aria-label={`${workItemNumber(kind, item.number)} ${item.title} ${workItemStatusLabel(kind, item.status)}`}
                className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md px-3 py-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <WorkItemLabel kind={kind} item={item} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">暂无关联{target}。</p>
      )}
    </section>
  )
}
