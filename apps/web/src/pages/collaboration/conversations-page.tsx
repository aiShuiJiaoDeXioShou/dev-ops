import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, UsersRound } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { botInboxOptions, taskQueries } from '@/features/bot-tasks/api/queries'
import { BotInbox } from '@/features/bot-tasks/ui/bot-inbox'
import { conversationsOptions, conversationsQueryKey } from '@/features/conversations/api/queries'
import { ConversationAvatar } from '@/features/conversations/ui/conversation-avatar'
import { ConversationIcon } from '@/features/conversations/ui/conversation-icon'
import { DirectConversationPicker } from '@/features/conversations/ui/direct-conversation-picker'
import { NewGroupDialog } from '@/features/conversations/ui/new-group-dialog'
import { useSession } from '@/features/identity/model/session'
import { workTagsOptions } from '@/features/work-tags/api/queries'
import { WorkTagDialog } from '@/features/work-tags/ui/work-tag-dialog'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { ConversationRoom } from './conversation-room'
import './conversations.css'

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

function TeamConversations({
  teamId,
  id,
  userId,
  readOnly,
}: {
  teamId: string
  id?: string
  userId: string
  readOnly: boolean
}) {
  const [filter, setFilter] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [newDirectOpen, setNewDirectOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const tagOpener = useRef<HTMLButtonElement>(null)
  const [tagId, setTagId] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const shouldShowFilters = filtersOpen || !!tagId
  const tags = useInfiniteQuery(workTagsOptions(teamId))
  const tagItems = tags.data?.pages.flatMap(({ data }) => data.items) ?? []
  const activeTag = tagItems.some(({ id }) => id === tagId) ? tagId : ''

  const conversationOpener = useRef<HTMLButtonElement>(null)
  const client = useQueryClient()
  const listToggleRef = useRef<HTMLButtonElement>(null)
  const listCloseRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const openNavigation = useOutletContext<(opener: HTMLElement | null) => void>()
  const inbox = useQuery(botInboxOptions(teamId))
  const [params, setParams] = useSearchParams()
  const isInbox = params.get('view') === 'inbox'
  const linkedTask = params.get('task') ?? undefined
  const linkedSkill = params.get('skill') ?? undefined
  const skillSearch = linkedSkill ? `?skill=${encodeURIComponent(linkedSkill)}` : ''
  const list = useInfiniteQuery(conversationsOptions(teamId, useDeferredValue(filter.trim()), activeTag || undefined))
  const rooms = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const defaultId = !isInbox && !linkedSkill && !filter && !activeTag ? rooms[0]?.id : undefined
  const selectedId = id ?? defaultId
  const showListErrorInMain = !isInbox && !selectedId && rooms.length === 0 && list.isError
  const hasNoConversations = list.isSuccess && rooms.length === 0 && !filter && !activeTag
  let emptyDescription = '从会话列表选择要继续的对话。'
  if (hasNoConversations) {
    emptyDescription = readOnly ? '加入会话后，可在这里查看对话。' : '使用会话列表中的加号新建私聊或群组。'
  } else if (linkedSkill) {
    emptyDescription = '选择已配置这项技能的会话，技能会带入输入框。'
  }
  useEffect(() => {
    if (!id && defaultId) void navigate(`/collaboration/${defaultId}`, { replace: true })
  }, [defaultId, id, navigate])
  const closeList = () => {
    setListOpen(false)
    listToggleRef.current?.focus()
  }
  useEffect(() => {
    if (listOpen) listCloseRef.current?.focus()
  }, [listOpen])
  return (
    <div
      className={cn('collab-layout live-conversations', listOpen && 'mobile-rooms-open')}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          listOpen &&
          !newDirectOpen &&
          !newGroupOpen &&
          !tagDialogOpen &&
          !event.defaultPrevented
        )
          closeList()
      }}
    >
      <h1 className="sr-only">协作</h1>
      {listOpen && (
        <Button
          type="button"
          unstyled
          className="mobile-rooms-backdrop"
          variant="ghost"
          tabIndex={-1}
          aria-label="关闭会话列表"
          onClick={closeList}
        />
      )}
      <aside className="conversation-list" aria-label="会话列表" id="team-conversations">
        <div className="row conv-tools">
          <Button
            unstyled
            type="button"
            className="icon-btn mobile-menu"
            aria-label="打开导航"
            onClick={() => {
              setListOpen(false)
              openNavigation(listToggleRef.current)
            }}
          >
            <ConversationIcon name="menu" />
          </Button>
          <label className="search">
            <ConversationIcon name="search" />
            <Input
              type="search"
              className="conversation-search-input h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={filter}
              maxLength={80}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button unstyled type="button" ref={conversationOpener} className="icon-btn" aria-label="新建会话">
                  <ConversationIcon name="plus" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8}>
                <DropdownMenuItem className="min-h-10 gap-3 px-3" onSelect={() => setNewDirectOpen(true)}>
                  <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
                  新建私聊
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-10 gap-3 px-3" onSelect={() => setNewGroupOpen(true)}>
                  <UsersRound className="size-4 shrink-0" aria-hidden="true" />
                  新建群组
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            unstyled
            type="button"
            ref={tagOpener}
            className="icon-btn room-filter-toggle"
            aria-label="会话筛选"
            aria-expanded={shouldShowFilters}
            onClick={() => {
              if (tagId) setTagId('')
              setFiltersOpen(!shouldShowFilters)
            }}
          >
            <ConversationIcon name="more" />
          </Button>
          {listOpen && (
            <Button
              ref={listCloseRef}
              type="button"
              size="icon"
              variant="ghost"
              className="icon-btn"
              aria-label="收起会话列表"
              onClick={closeList}
            >
              <ConversationIcon name="close" />
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          unstyled
          className={cn('inbox-link', isInbox && 'active')}
          aria-pressed={isInbox}
          onClick={() => {
            closeList()
            void navigate('/collaboration?view=inbox')
          }}
        >
          <ConversationIcon name="inbox" />
          待你处理
          {inbox.isSuccess && <span className="counter">{inbox.data.data.count}</span>}
        </Button>
        {shouldShowFilters && (
          <div className="row flex-wrap">
            <Select aria-label="按工作标签筛选" value={activeTag} onChange={(event) => setTagId(event.target.value)}>
              <option value="">全部标签</option>
              {tagItems.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            {!readOnly && (
              <Button type="button" variant="ghost" onClick={() => setTagDialogOpen(true)}>
                管理标签
              </Button>
            )}
            {tags.hasNextPage && (
              <Button type="button" variant="ghost" onClick={() => void tags.fetchNextPage()}>
                更多标签
              </Button>
            )}
            {tags.isError && (
              <Button type="button" variant="ghost" onClick={() => void tags.refetch()}>
                重试加载标签
              </Button>
            )}
          </div>
        )}
        {list.isPending && <DelayedPageSkeleton />}
        {list.isError && !showListErrorInMain && (
          <div className="row flex-wrap small muted" role="status">
            会话列表加载失败
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={list.isFetching}
              onClick={() => void list.refetch()}
            >
              {list.isFetching ? '正在重试…' : '重试'}
            </Button>
          </div>
        )}
        {hasNoConversations && <EmptyState mascot="orbit" title="暂无会话" className="conversation-list-empty" />}
        {list.isSuccess && rooms.length === 0 && !hasNoConversations && <p className="small muted">没有匹配的会话</p>}
        {rooms.map((room) => (
          <Button
            key={room.id}
            type="button"
            unstyled
            className={cn('conversation-item', !isInbox && room.id === selectedId && 'active')}
            variant="ghost"
            aria-pressed={!isInbox && room.id === selectedId}
            onClick={() => {
              closeList()
              void navigate(`/collaboration/${room.id}${skillSearch}`)
            }}
          >
            <span className="conversation-mark">
              <ConversationAvatar kind={room.kind} bots={room.botAvatars} />
            </span>
            <span className="conversation-summary">
              <span className="conversation-title-row">
                <strong>{room.name}</strong>
                {room.lastMessagePreview && (
                  <time dateTime={room.lastMessageAt}>{clock.format(new Date(room.lastMessageAt))}</time>
                )}
              </span>
              <small>{room.lastMessagePreview ?? '还没有消息'}</small>
            </span>
          </Button>
        ))}
        {list.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            加载更多会话
          </Button>
        )}
      </aside>
      {selectedId && !isInbox ? (
        <ConversationRoom
          key={`${selectedId}:${linkedTask ?? ''}`}
          id={selectedId}
          initialTaskId={linkedTask}
          initialSkillId={linkedSkill}
          onSkillUsed={() => {
            const updated = new URLSearchParams(params)
            updated.delete('skill')
            setParams(updated, { replace: true })
          }}

          userId={userId}
          readOnly={readOnly}
          listOpen={listOpen}
          openList={() => setListOpen(true)}
          listToggleRef={listToggleRef}
        />
      ) : (
        <section className="conversation-main dsh-chat">
          <header className="dsh-chat-header">
            <Button
              unstyled
              ref={listToggleRef}
              type="button"
              variant="ghost"
              size="icon"
              className="dsh-icon-btn dsh-room-toggle"
              aria-label="打开会话列表"
              aria-expanded={listOpen}
              aria-controls="team-conversations"
              onClick={() => setListOpen(true)}
            >
              <ConversationIcon name="menu" />
            </Button>
          </header>
          {isInbox ? (
            <BotInbox teamId={teamId} />
          ) : showListErrorInMain ? (
            <PageError
              title="会话列表加载失败"
              error={list.error}
              retrying={list.isFetching}
              onRetry={() => void list.refetch()}
            />
          ) : list.isPending ? (
            <DelayedPageSkeleton />
          ) : (
            <EmptyState
              mascot={hasNoConversations ? 'orbit' : undefined}
              icon={hasNoConversations ? undefined : <ConversationIcon name="chat" />}
              className={hasNoConversations ? 'conversation-main-empty' : undefined}
              title={hasNoConversations ? '还没有会话' : '选择会话'}
              description={emptyDescription}
              action={
                <Button asChild variant="outline">
                  <Link to="/capabilities/bots">查看智能体</Link>
                </Button>
              }
            />
          )}
        </section>
      )}
      {tagDialogOpen && (
        <WorkTagDialog
          teamId={teamId}
          onClose={() => {
            setTagDialogOpen(false)
            requestAnimationFrame(() => tagOpener.current?.focus())
          }}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: conversationsQueryKey })
            void client.invalidateQueries({ queryKey: ['bot-conversation'] })
            void client.invalidateQueries({ queryKey: taskQueries })
          }}
        />
      )}
      {newDirectOpen && (
        <DirectConversationPicker
          teamId={teamId}
          onClose={() => setNewDirectOpen(false)}
          onOpened={() => {
            setNewDirectOpen(false)
            setListOpen(false)
          }}
          onRestoreFocus={() => {
            requestAnimationFrame(() => {
              const opener = conversationOpener.current
              opener?.focus()
              if (document.activeElement !== opener) listToggleRef.current?.focus()
            })
          }}
        />
      )}
      {newGroupOpen && (
        <NewGroupDialog
          teamId={teamId}
          userId={userId}
          onClose={() => {
            setNewGroupOpen(false)
            requestAnimationFrame(() => conversationOpener.current?.focus())
          }}
          onCreated={(room) => {
            setNewGroupOpen(false)
            closeList()
            void client.invalidateQueries({ queryKey: conversationsQueryKey })
            void navigate(`/collaboration/${room.id}${skillSearch}`)
          }}
        />
      )}
    </div>
  )
}

/** 查看当前团队的协作会话及消息，切换团队时清理当前会话的本地交互状态。 */
export function Component() {
  const { currentTeam, user, role, isReady } = useSession()
  const { conversationId } = useParams()
  if (!isReady) return <DelayedPageSkeleton />
  if (!currentTeam) return <EmptyState mascot="group" title="尚未选择团队" />
  return (
    <TeamConversations
      key={currentTeam.id}
      teamId={currentTeam.id}
      id={conversationId}
      userId={user.id}
      readOnly={role === 'viewer'}
    />
  )
}
