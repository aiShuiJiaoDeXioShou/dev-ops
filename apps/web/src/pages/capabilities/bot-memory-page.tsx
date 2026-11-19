import { useDeferredValue, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, Plus, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { botMemoryKey, botMemoryOptions, type BotMemory } from '@/features/bots/api/memories'
import { botChoicesOptions } from '@/features/bots/api/queries'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { MemoryDialog } from '@/features/bots/ui/memory-dialog'
import { useSession } from '@/features/identity/model/session'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
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
import { Select } from '@/shared/ui/controls/select'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'

function TeamMemory({ teamId, canWrite, isAdmin }: { teamId: string; canWrite: boolean; isAdmin: boolean }) {
  const client = useQueryClient()
  const [query, setQuery] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const botId = searchParams.get('botId') ?? ''
  const [scope, setScope] = useState<BotMemory['scope'] | undefined>()
  const [editing, setEditing] = useState<BotMemory | 'new'>()
  const opener = useRef<HTMLElement>(null)
  const add = useRef<HTMLButtonElement>(null)
  const botChoices = useInfiniteQuery(botChoicesOptions(teamId))
  const bots = botChoices.data?.pages.flatMap(({ data }) => data.items) ?? []
  const list = useInfiniteQuery(
    botMemoryOptions(teamId, {
      botId: botId || undefined,
      scope,
      query: useDeferredValue(query.trim()) || undefined,
    }),
  )
  const items = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const refresh = () => void client.invalidateQueries({ queryKey: botMemoryKey })
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.removeBotMemory(id, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: refresh,
  })
  const consolidate = useMutation({
    mutationFn: (id: string) => apiClient.consolidateBotMemories(id, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: refresh,
  })
  function closeDialog() {
    setEditing(undefined)
    requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : add.current)?.focus())
  }
  return (
    <div className="work-padding">
      <h1 className="sr-only">记忆</h1>
      <div className="work-toolbar flex-wrap">
        <label className="search">
          <Search className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
          <Input
            aria-label="搜索记忆"
            type="search"
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索记忆"
          />
        </label>
        <Select
          aria-label="筛选智能体"
          value={botId}
          onChange={(event) => {
            const value = event.target.value
            consolidate.reset()
            setSearchParams(
              (previous) => {
                const next = new URLSearchParams(previous)
                if (value) next.set('botId', value)
                else next.delete('botId')
                return next
              },
              { replace: true },
            )
          }}
        >
          <option value="">全部智能体</option>
          {bots.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="筛选记忆范围"
          value={scope ?? ''}
          onChange={(event) => {
            const value = event.target.value
            setScope(value === 'user' || value === 'bot' ? value : undefined)
          }}
        >
          <option value="">全部范围</option>
          <option value="user">用户画像</option>
          <option value="bot">Bot 笔记</option>
        </Select>
        {botChoices.hasNextPage && (
          <Button type="button" variant="ghost" onClick={() => void botChoices.fetchNextPage()}>
            更多智能体
          </Button>
        )}
        {botChoices.isError && (
          <Button type="button" variant="ghost" onClick={() => void botChoices.refetch()}>
            重试加载智能体
          </Button>
        )}
        {isAdmin && botId && (
          <Button
            type="button"
            variant="outline"
            disabled={consolidate.isPending}
            aria-busy={consolidate.isPending}
            onClick={() => consolidate.mutate(botId)}
          >
            {consolidate.isPending ? '排队中…' : '整理记忆'}
          </Button>
        )}
        {canWrite && (
          <Button
            ref={add}
            type="button"
            disabled={!bots.length}
            onClick={(event) => {
              opener.current = event.currentTarget
              setEditing('new')
            }}
          >
            <Plus className="size-4" aria-hidden="true" /> 新增记忆
          </Button>
        )}
      </div>
      {consolidate.isSuccess && (
        <p role="status" className="small muted">
          {consolidate.data.data.runId ? '整理已排队，完成后可刷新查看新记忆。' : '当前没有可排队的整理运行。'}
        </p>
      )}
      {consolidate.isError && (
        <p className="field-error" role="alert">
          {describeRequestError(consolidate.error).description}
        </p>
      )}
      {list.isPending && <DelayedPageSkeleton />}
      {list.isError && <PageError title="记忆加载失败" error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && items.length === 0 && (
        <EmptyState icon={<Brain />} title={query || scope || botId ? '没有匹配的记忆' : '还没有记忆'} />
      )}
      {items.map((item) => (
        <article className="memory-card" key={item.id}>
          <div className="row flex-wrap">
            <BotAvatar botId={item.botId} avatarKey={bots.find(({ id }) => id === item.botId)?.avatarKey ?? null} />
            <strong>{item.botName}</strong>
            <span className="badge">{item.scope === 'user' ? '用户画像' : 'Bot 笔记'}</span>
            {item.source?.kind === 'consolidation' && <span className="badge">整理</span>}
            {item.essential && <span className="badge">常驻</span>}
            <span className="spacer" />
            {canWrite && item.canEdit && (
              <Button
                type="button"
                variant="ghost"
                onClick={(event) => {
                  opener.current = event.currentTarget
                  setEditing(item)
                }}
              >
                编辑
              </Button>
            )}
            {canWrite && item.canRemove && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" disabled={remove.isPending}>
                    删除
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
                    <AlertDialogDescription>删除后，新的运行将不再使用这条记忆。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.mutate(item.id)}>确认删除</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <p className="whitespace-pre-wrap wrap-break-word">{item.content}</p>
          <div className="row flex-wrap small muted">
            {item.sourceConversationId && item.sourceConversationName && (
              <Link to={`/collaboration/${item.sourceConversationId}`}>{item.sourceConversationName}</Link>
            )}
            {item.sourceUserName && <span>来源成员 {item.sourceUserName}</span>}
            <time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
          </div>
          {item.source?.detail && (
            <details className="small muted">
              <summary>查看整理来源</summary>
              <p>
                {formatDateTime(item.source.detail.from)} 至 {formatDateTime(item.source.detail.to)}
              </p>
              <p>
                {item.source.detail.conversationCount} 个会话，合并 {item.source.detail.mergedMemoryIds.length} 条记忆
              </p>
            </details>
          )}
        </article>
      ))}
      {remove.isError && (
        <p className="field-error" role="alert">
          {describeRequestError(remove.error).description}
        </p>
      )}
      {list.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          加载更多记忆
        </Button>
      )}
      {editing && (
        <MemoryDialog
          item={editing === 'new' ? undefined : editing}
          teamId={teamId}
          bots={bots}
          botId={botId || undefined}
          allowBotScope={isAdmin}
          onClose={closeDialog}
          onSaved={() => {
            refresh()
            closeDialog()
          }}
        />
      )}
    </div>
  )
}

/** 查看选中团队中可见的 Bot 记忆。 */
export function Component() {
  const { currentTeam, role, isReady } = useSession()
  if (!isReady) return <DelayedPageSkeleton />
  if (!currentTeam) return <EmptyState mascot="group" title="尚未选择团队" />
  return (
    <TeamMemory
      key={currentTeam.id}
      teamId={currentTeam.id}
      canWrite={role === 'admin' || role === 'developer'}
      isAdmin={role === 'admin'}
    />
  )
}
