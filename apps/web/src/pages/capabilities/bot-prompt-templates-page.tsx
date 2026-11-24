import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, FileText, GitFork, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router'
import {
  hasPromptArguments,
  renderPromptWithArguments,
  suggestForkedTemplateName,
} from '@/features/bots/model/prompt-template-utils'
import {
  PromptHighlightedBody,
  PromptTemplateEditorDialog,
  type BotPromptTemplateItem,
  type PromptTemplateDraft,
} from '@/features/bots/ui/prompt-template-editor-dialog'
import { useSession } from '@/features/identity/model/session'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/controls/alert-dialog'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { CompactListSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'

const templatesKey = ['bot-prompt-templates']

type TemplateKindFilter = 'all' | 'args' | 'static'

/** 复制文本到剪贴板；环境不支持时返回 false。 */
async function copyPromptText(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function PromptTemplateHub({ teamId, write }: { teamId: string; write: boolean }) {
  const [params, setParams] = useSearchParams()
  const searchParam = params.get('query') ?? ''
  const [searchInput, setSearchInput] = useState(searchParam)
  const kindParam = params.get('kind')
  const kind: TemplateKindFilter = kindParam === 'args' || kindParam === 'static' ? kindParam : 'all'
  const selectedParam = params.get('template')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<BotPromptTemplateItem | undefined>(undefined)
  const [forkDraft, setForkDraft] = useState<PromptTemplateDraft | null>(null)
  const [argSample, setArgSample] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const client = useQueryClient()
  const { showToast } = useToast()

  const queryText = useDeferredValue(searchInput.trim())

  useEffect(() => {
    setSearchInput(searchParam)
  }, [searchParam])

  useEffect(() => {
    if (searchInput === searchParam) return
    const timer = window.setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (searchInput.trim()) next.set('query', searchInput.trim())
          else next.delete('query')
          return next
        },
        { replace: true },
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, searchParam, setParams])

  const list = useInfiniteQuery({
    queryKey: [...templatesKey, teamId, queryText],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      apiClient.listBotPromptTemplates(
        teamId,
        { query: queryText || undefined, cursor: pageParam || undefined },
        { signal },
      ),
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })

  const rawItems = useMemo(() => list.data?.pages.flatMap(({ data }) => data.items) ?? [], [list.data])
  const items = useMemo(
    () =>
      rawItems.filter((item) => {
        const hasArgs = hasPromptArguments(item.body)
        if (kind === 'args') return hasArgs
        if (kind === 'static') return !hasArgs
        return true
      }),
    [rawItems, kind],
  )

  const selectedTemplate = useMemo(() => {
    if (items.length === 0) return undefined
    return items.find((item) => item.id === selectedParam) ?? items[0]
  }, [items, selectedParam])

  useEffect(() => {
    setArgSample('')
  }, [selectedTemplate?.id])

  const removeMutation = useMutation({
    mutationFn: (template: BotPromptTemplateItem) =>
      apiClient.removeBotPromptTemplate(template.id, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: async (_, template) => {
      await client.invalidateQueries({ queryKey: [...templatesKey, teamId] })
      showToast(`已删除模板 /${template.name}`, 'success')
      if (selectedParam === template.id) updateParam('template', '')
    },
    onError: (cause: unknown) => showToast(describeRequestError(cause).description, 'error'),
  })

  const updateParam = (key: string, value: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const clearFilters = () => {
    setSearchInput('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const handleCopy = async (key: string, text: string, label: string) => {
    const ok = await copyPromptText(text)
    if (ok) {
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1400)
    }
    showToast(ok ? `已复制${label}` : '浏览器未允许自动复制，请手动选择内容。', ok ? 'success' : 'info')
  }

  const openCreate = (trigger: HTMLElement) => {
    openerRef.current = trigger
    setEditingTemplate(undefined)
    setForkDraft(null)
    setEditorOpen(true)
  }

  const openEdit = (template: BotPromptTemplateItem, trigger: HTMLElement) => {
    openerRef.current = trigger
    setEditingTemplate(template)
    setForkDraft(null)
    setEditorOpen(true)
  }

  const openFork = (template: BotPromptTemplateItem, trigger: HTMLElement) => {
    openerRef.current = trigger
    setEditingTemplate(undefined)
    setForkDraft({
      name: suggestForkedTemplateName(template.name),
      description: template.description,
      body: template.body,
    })
    setEditorOpen(true)
  }

  const filtered = Boolean(queryText || kind !== 'all')
  const selectedHasArgs = selectedTemplate ? hasPromptArguments(selectedTemplate.body) : false
  const renderedPreview = selectedTemplate
    ? renderPromptWithArguments(selectedTemplate.body, argSample)
    : ''

  return (
    <div className="cap-hub-page" aria-label="提示模板">
      <header className="cap-hub-head">
        <div className="cap-hub-title-group">
          <div className="cap-hub-title-row">
            <h1 className="cap-hub-title">提示模板</h1>
            {list.isSuccess && <span className="cap-hub-count">{items.length}</span>}
          </div>
          <p className="cap-hub-subtitle">
            在会话输入框键入 <code>/</code> 即可调用团队共享模板，支持 <code>$ARGUMENTS</code> 动态参数。
          </p>
        </div>
        {write && (
          <div className="cap-hub-actions">
            <Button type="button" size="sm" onClick={(event) => openCreate(event.currentTarget)}>
              <Plus className="size-4" aria-hidden="true" />
              新建模板
            </Button>
          </div>
        )}
      </header>

      <div className="cap-hub-toolbar">
        <div className="cap-hub-filters">
          <div className="cap-hub-pills" role="group" aria-label="模板参数类型筛选">
            {(
              [
                ['all', '全部'],
                ['args', '含参数 $ARGUMENTS'],
                ['static', '纯指令'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                className={cn('cap-hub-pill', kind === value && 'active')}
                aria-pressed={kind === value}
                onClick={() => updateParam('kind', value === 'all' ? '' : value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <label className="cap-hub-search">
          <Search className="search-icon" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            maxLength={80}
            aria-label="搜索模板"
            placeholder="搜索 /命令、摘要或正文"
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
      </div>

      {list.isPending && <CompactListSkeleton rows={4} bordered trailing label="提示模板加载中" />}
      {list.isError && (
        <PageError
          title="提示模板加载失败"
          error={list.error}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<FileText />}
          title={filtered ? '没有匹配的模板' : '还没有提示模板'}
          description={
            filtered
              ? '换个关键词或参数筛选条件，或清除筛选后查看全部模板。'
              : '将团队高频提问整理为 /命令 模板，让成员在对话中一键复用。'
          }
          action={
            filtered ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                清除筛选
              </Button>
            ) : write ? (
              <Button type="button" onClick={(event) => openCreate(event.currentTarget)}>
                <Plus className="size-4" aria-hidden="true" />
                新建模板
              </Button>
            ) : undefined
          }
        />
      )}

      {items.length > 0 && (
        <div className="prompt-hub-layout">
          <div className="min-w-0 space-y-3">
            <ul className="prompt-hub-list" aria-label="提示模板列表">
              {items.map((template) => {
                const isSelected = selectedTemplate?.id === template.id
                const hasArgs = hasPromptArguments(template.body)
                const isCmdCopied = copiedKey === `cmd:${template.id}`
                return (
                  <li
                    key={template.id}
                    className={cn('prompt-hub-card', isSelected && 'is-selected')}
                    onClick={(event) => {
                      if (isNestedInteractiveTarget(event.target)) return
                      updateParam('template', template.id)
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 hover:bg-transparent"
                          aria-pressed={isSelected}
                          onClick={() => updateParam('template', template.id)}
                        >
                          <span className="prompt-slash-badge font-mono">/{template.name}</span>
                        </Button>
                        <Tag variant={hasArgs ? 'blue' : 'neutral'}>{hasArgs ? '含参数' : '纯指令'}</Tag>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          aria-label={`复制命令 /${template.name}`}
                          onClick={() => void handleCopy(`cmd:${template.id}`, `/${template.name}`, ` /${template.name}`)}
                        >
                          {isCmdCopied ? (
                            <Check className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Copy className="size-3.5" aria-hidden="true" />
                          )}
                          {isCmdCopied ? '已复制' : '复制命令'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          aria-label={`${write ? '编辑' : '查看'} /${template.name}`}
                          onClick={(event) => openEdit(template, event.currentTarget)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          {write ? '编辑' : '查看'}
                        </Button>
                      </div>
                    </div>

                    <p className="m-0 text-sm text-foreground wrap-break-word">{template.description}</p>

                    <div className="prompt-snippet font-mono">
                      <PromptHighlightedBody body={template.body} />
                    </div>

                    <div className="skill-hub-meta">
                      <span>{template.body.length} 字</span>
                      <span aria-hidden="true">·</span>
                      <span>更新于 {formatRelativeTime(template.updatedAt)}</span>
                    </div>
                  </li>
                )
              })}
            </ul>

            {list.hasNextPage && (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {list.isFetchingNextPage ? '加载中…' : '加载更多模板'}
                </Button>
              </div>
            )}
          </div>

          {selectedTemplate && (
            <aside className="prompt-detail-panel" aria-label="模板详情与试填预览">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="prompt-slash-badge font-mono">/{selectedTemplate.name}</span>
                <div className="flex items-center gap-1">
                  {write && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={(event) => openFork(selectedTemplate, event.currentTarget)}
                    >
                      <GitFork className="size-3.5" aria-hidden="true" />
                      派生
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={(event) => openEdit(selectedTemplate, event.currentTarget)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    {write ? '编辑' : '查看'}
                  </Button>
                </div>
              </div>

              <p className="m-0 text-sm text-muted-foreground wrap-break-word">{selectedTemplate.description}</p>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="prompt-section-label">模板正文</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      void handleCopy(`body:${selectedTemplate.id}`, selectedTemplate.body, '模板正文')
                    }
                  >
                    {copiedKey === `body:${selectedTemplate.id}` ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5" aria-hidden="true" />
                    )}
                    {copiedKey === `body:${selectedTemplate.id}` ? '已复制' : '复制正文'}
                  </Button>
                </div>
                <div className="prompt-detail-box font-mono text-xs">
                  <PromptHighlightedBody body={selectedTemplate.body} />
                </div>
              </div>

              {selectedHasArgs && (
                <div className="space-y-2 border-t border-border pt-3">
                  <label className="block space-y-1.5">
                    <span className="prompt-section-label block">试填预览 · $ARGUMENTS</span>
                    <Input
                      value={argSample}
                      maxLength={500}
                      placeholder="输入测试参数，实时查看替换后的提示词…"
                      onChange={(event) => setArgSample(event.target.value)}
                    />
                  </label>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="prompt-section-label">最终发给 Bot 的提示词</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        void handleCopy(`preview:${selectedTemplate.id}`, renderedPreview, '替换后的提示词')
                      }
                    >
                      {copiedKey === `preview:${selectedTemplate.id}` ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      {copiedKey === `preview:${selectedTemplate.id}` ? '已复制' : '复制结果'}
                    </Button>
                  </div>
                  <div className="prompt-detail-box font-mono text-xs">{renderedPreview}</div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>
                  更新于 {formatDateTime(selectedTemplate.updatedAt)} · {selectedTemplate.body.length} 字
                </span>
                {write && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive"
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        删除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除提示模板 /{selectedTemplate.name}？</AlertDialogTitle>
                        <AlertDialogDescription>
                          删除后无法恢复，此命令会立即从团队会话的 / 模板列表中移除。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeMutation.mutate(selectedTemplate)}>
                          {removeMutation.isPending ? '删除中…' : '确认删除'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      <PromptTemplateEditorDialog
        teamId={teamId}
        open={editorOpen}
        template={editingTemplate}
        initialDraft={forkDraft}
        write={write}
        onOpenChange={setEditorOpen}
        onSaved={(saved) => updateParam('template', saved.id)}
        onRemoved={(removedId) => {
          if (selectedParam === removedId) updateParam('template', '')
        }}
        onRestoreFocus={() => {
          const target = openerRef.current
          if (target?.isConnected) target.focus()
        }}
      />
    </div>
  )
}

/**
 * 展示团队共享的提示模板 Hub，支持参数筛选、正文与试填预览及角色受控的维护操作。
 * @returns 当前团队的提示模板 Hub 页面。
 */
export function Component() {
  const { currentTeam, role, isReady } = useSession()
  if (!isReady) return <CompactListSkeleton rows={4} bordered trailing label="提示模板加载中" className="cap-hub-page" />
  if (!currentTeam) return <EmptyState mascot="group" title="尚未选择团队" />
  return <PromptTemplateHub key={currentTeam.id} teamId={currentTeam.id} write={role === 'admin' || role === 'developer'} />
}
