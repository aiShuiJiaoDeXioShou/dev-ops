import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ClipboardList, Inbox, Menu, MessagesSquare, Plus, Search, Settings, X } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { botInboxOptions, taskQueries } from '@/features/bot-tasks/api/queries'
import { BotInbox } from '@/features/bot-tasks/ui/bot-inbox'
import { ConversationTaskPanel } from '@/features/bot-tasks/ui/conversation-task-panel'
import { NewTaskDialog } from '@/features/bot-tasks/ui/new-task-dialog'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import {
  conversationEventsOptions,
  conversationOptions,
  conversationsOptions,
  conversationsQueryKey,
  messagesOptions,
} from '@/features/conversations/api/queries'
import { ConversationComposer } from '@/features/conversations/ui/conversation-composer'
import { ConversationMessages } from '@/features/conversations/ui/conversation-messages'
import { GroupSettings } from '@/features/conversations/ui/group-settings'
import { NewGroupDialog } from '@/features/conversations/ui/new-group-dialog'
import { useSession } from '@/features/identity/model/session'
import { workTagsOptions } from '@/features/work-tags/api/queries'
import { WorkTagDialog } from '@/features/work-tags/ui/work-tag-dialog'
import { WorkTagEditor } from '@/features/work-tags/ui/work-tag-editor'
import { Select } from '@/shared/ui/controls/select'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import './conversations.css'

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const runStatuses: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  stopped: '已停止',
  failed: '执行失败',
}

function activityText(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value: unknown = Reflect.get(payload, key)
  return typeof value === 'string' ? value : undefined
}

function ConversationRoom({
  id,
  userId,
  readOnly,
  listOpen,
  openList,
  listToggleRef,
  initialTaskId,
  initialSkillId,
  onSkillUsed,
}: {
  id: string
  userId: string
  readOnly: boolean
  listOpen: boolean
  openList: () => void
  listToggleRef: React.RefObject<HTMLButtonElement | null>
  initialTaskId?: string
  initialSkillId?: string
  onSkillUsed: () => void
}) {
  const client = useQueryClient()
  const [panel, setPanel] = useState<'task' | 'settings' | null>(initialTaskId ? 'task' : null)
  const taskPanelOpen = panel === 'task'
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [taskId, setTaskId] = useState(initialTaskId)
  const taskOpener = useRef<HTMLButtonElement>(null)
  const settingsOpener = useRef<HTMLButtonElement>(null)
  const newTaskOpener = useRef<HTMLElement>(null)
  const detail = useQuery({ ...conversationOptions(id), refetchInterval: 10000 })
  const messages = useInfiniteQuery({ ...messagesOptions(id), enabled: detail.isSuccess })
  const events = useQuery({ ...conversationEventsOptions(client, id), enabled: detail.isSuccess })
  const room = detail.data?.data
  const stored =
    messages.data?.pages
      .slice()
      .reverse()
      .flatMap(({ data }) => data.items) ?? []
  const finalRuns = new Set(stored.flatMap((item) => (item.speakerKind === 'bot' && item.runId ? [item.runId] : [])))
  const activeRuns = new Map(events.data?.activeRuns.map((run) => [run.id, run]))
  const ongoingIds = new Set([...activeRuns.keys(), ...Object.keys(events.data?.progress ?? {})])
  const botMember = room?.members.find((member) => member.kind === 'bot')
  useEffect(() => {
    if (!panel || newTaskOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== 'Escape' ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return
      setPanel(null)
      const opener = panel === 'task' ? taskOpener : settingsOpener
      opener.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [panel, newTaskOpen])
  useEffect(() => {
    if (events.data?.cursor && events.data.cursor !== '0' && taskPanelOpen) {
      void client.invalidateQueries({ queryKey: taskQueries })
    }
  }, [client, events.data?.cursor, taskPanelOpen])
  if (detail.isPending) return <DelayedPageSkeleton />
  if (detail.isError)
    return <PageError title="会话加载失败" error={detail.error} onRetry={() => void detail.refetch()} />
  if (!room) return null

  const items = stored.map((item) => ({
    id: item.id,
    name: item.speakerName ?? '会话通知',
    kind: item.speakerKind,
    text: item.body.blocks
      .filter((block) => block.type !== 'tool_activity')
      .map((block) => block.text)
      .join('\n\n'),
    time: item.createdAt,
  }))
  const ongoing = [...ongoingIds].flatMap((runId) => {
    if (finalRuns.has(runId)) return []
    const active = activeRuns.get(runId)
    const progress = events.data?.progress[runId]
    const status = active?.status ?? progress?.status
    if (!status || !runStatuses[status]) return []
    return [
      {
        id: runId,
        name: room.members.find((member) => member.id === active?.botId)?.name ?? botMember?.name ?? room.name,
        kind: 'bot' as const,
        text: progress?.text ?? '',
        status: progress?.failureMessage ? `${runStatuses[status]} · ${progress.failureMessage}` : runStatuses[status],
      },
    ]
  })

  const closeTasks = () => {
    setPanel(null)
    taskOpener.current?.focus()
  }
  return (
    <>
      <Tabs className="conversation-main dsh-chat gap-0" defaultValue="chat" aria-label="当前会话">
        <header className="dsh-chat-header">
          <div className="dsh-title-row">
            <Button
              ref={listToggleRef}
              type="button"
              variant="ghost"
              size="icon"
              className="dsh-icon-btn dsh-room-toggle"
              aria-label="打开会话列表"
              aria-expanded={listOpen}
              aria-controls="team-conversations"
              onClick={openList}
            >
              <Menu className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            </Button>
            <div className="dsh-title">
              <span className="dsh-title-avatar">
                {room.kind === 'direct' && botMember ? (
                  <BotAvatar botId={botMember.id} avatarKey={null} />
                ) : (
                  <MessagesSquare className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                )}
              </span>
              <span className="dsh-title-text">
                <strong>{room.name}</strong>
                <small>
                  {room.kind === 'direct' ? '智能体私聊' : '群组'} · {room.members.length} 位成员
                </small>
              </span>
            </div>
            <div className="dsh-title-actions">
              <Button
                ref={taskOpener}
                type="button"
                variant="ghost"
                size="icon"
                className="dsh-icon-btn"
                aria-label="任务列表"
                aria-pressed={taskPanelOpen}
                onClick={() => (taskPanelOpen ? closeTasks() : setPanel('task'))}
              >
                <ClipboardList className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
              </Button>
              {!readOnly && room.kind === 'group' && (
                <Button
                  ref={settingsOpener}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="dsh-icon-btn"
                  aria-label="会话设置"
                  aria-pressed={panel === 'settings'}
                  onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
                >
                  <Settings className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          <TabsList className="dsh-tabs w-auto gap-6 rounded-none bg-transparent p-0" aria-label="会话视图">
            <TabsTrigger value="chat" variant="underline" className="dsh-tab">
              对话
            </TabsTrigger>
            <TabsTrigger value="activity" variant="underline" className="dsh-tab">
              轨迹
            </TabsTrigger>
            <TabsTrigger value="context" variant="underline" className="dsh-tab">
              上下文
            </TabsTrigger>
            <TabsTrigger value="members" variant="underline" className="dsh-tab">
              编队
            </TabsTrigger>
          </TabsList>
        </header>
        <TabsContent value="chat" className="dsh-scroll-area">
          {messages.isPending && <DelayedPageSkeleton />}
          {messages.isError && (
            <PageError title="消息加载失败" error={messages.error} onRetry={() => void messages.refetch()} />
          )}
          {messages.isSuccess && (
            <ConversationMessages
              items={[...items, ...ongoing]}
              roomName={room.name}
              hasEarlier={messages.hasNextPage}
              loadingEarlier={messages.isFetchingNextPage}
              loadEarlier={() => void messages.fetchNextPage()}
            />
          )}
          {events.data?.activity
            .filter(({ payload }) => activityText(payload, 'state') === 'memory_written')
            .map((event) => {
              const action = activityText(event.payload, 'action')
              return (
                <details key={event.sequence} className="dsh-note">
                  <summary>{action === 'remove' ? '已删除记忆' : action === 'patch' ? '已更新记忆' : '已记住'}</summary>
                  <Link to="/capabilities/memory">查看长期记忆</Link>
                </details>
              )
            })}
          {events.isError && (
            <div className="row dsh-readonly-note" role="status">
              运行状态更新失败
              <Button variant="ghost" type="button" onClick={() => void events.refetch()}>
                重试
              </Button>
            </div>
          )}
          <ConversationComposer
            room={room}
            readOnly={readOnly}
            initialSkillId={initialSkillId}
            runningId={events.data?.activeRuns.find((run) => run.status === 'running')?.id}
            onSent={() => {
              if (initialSkillId) onSkillUsed()
              void Promise.all([
                client.invalidateQueries({ queryKey: messagesOptions(id).queryKey }),
                client.invalidateQueries({ queryKey: conversationsQueryKey }),
                events.refetch(),
              ])
            }}
          />
        </TabsContent>
        <TabsContent value="activity" className="dsh-tab-panel">
          <div className="dsh-panel-scroll">
            {events.data?.activity.length ? (
              <ul className="tool-results">
                {events.data.activity.map((entry) => {
                  const name = activityText(entry.payload, 'name') ?? '工具活动'
                  const state = activityText(entry.payload, 'state')
                  const path = activityText(entry.payload, 'path')
                  const method = activityText(entry.payload, 'method')
                  const code = activityText(entry.payload, 'code')
                  return (
                    <li key={entry.sequence} className="tool-result-card">
                      <details>
                        <summary>
                          {name} · <time dateTime={entry.createdAt}>{clock.format(new Date(entry.createdAt))}</time>
                        </summary>
                        {path && (
                          <p className="wrap-break-word">
                            {method} {path}
                          </p>
                        )}
                        {code && <p>{code}</p>}
                        {state && <p className="small muted">{state}</p>}
                      </details>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState title="暂无执行轨迹" />
            )}
          </div>
        </TabsContent>
        <TabsContent value="context" className="dsh-tab-panel">
          <div className="dsh-panel-scroll">
            <WorkTagEditor
              tags={room.tags}
              teamId={room.teamId}
              target={{ targetKind: 'conversation', targetId: room.id }}
              readOnly={readOnly}
              onChanged={() => {
                void detail.refetch()
                void client.invalidateQueries({ queryKey: conversationsQueryKey })
              }}
            />

            {room.responsibility || room.instructions ? (
              <dl className="work-properties">
                {room.responsibility && (
                  <div>
                    <dt>职责</dt>
                    <dd>{room.responsibility}</dd>
                  </div>
                )}
                {room.instructions && (
                  <div>
                    <dt>指令</dt>
                    <dd>{room.instructions}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <EmptyState title="暂无会话上下文" />
            )}
          </div>
        </TabsContent>
        <TabsContent value="members" className="dsh-tab-panel">
          <div className="dsh-panel-scroll team-panel">
            <ul className="team-members">
              {room.members.map((member) => (
                <li className="team-member" key={member.id}>
                  <div className="team-main">
                    <div className="team-name">{member.name}</div>
                    <span className="team-role">{member.kind === 'bot' ? '智能体' : '成员'}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
      {taskPanelOpen && (
        <ConversationTaskPanel
          room={room}
          taskId={taskId}
          readOnly={readOnly}
          onClose={closeTasks}
          onNew={() => {
            const active = document.activeElement
            if (active instanceof HTMLElement) newTaskOpener.current = active
            setNewTaskOpen(true)
          }}
          onSelect={setTaskId}
          onChanged={() => void events.refetch()}
        />
      )}
      {panel === 'settings' && (
        <GroupSettings
          room={room}
          userId={userId}
          onClose={() => {
            setPanel(null)
            settingsOpener.current?.focus()
          }}
        />
      )}
      {newTaskOpen && (
        <NewTaskDialog
          room={room}
          userId={userId}
          onClose={() => {
            setNewTaskOpen(false)
            requestAnimationFrame(() => newTaskOpener.current?.focus())
          }}
          onCreated={(createdTask) => {
            setNewTaskOpen(false)
            setTaskId(createdTask)
            void client.invalidateQueries({ queryKey: taskQueries })
            void events.refetch()
          }}
        />
      )}
    </>
  )
}

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
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const tagOpener = useRef<HTMLButtonElement>(null)
  const [tagId, setTagId] = useState('')
  const tags = useInfiniteQuery(workTagsOptions(teamId))
  const tagItems = tags.data?.pages.flatMap(({ data }) => data.items) ?? []
  const activeTag = tagItems.some(({ id }) => id === tagId) ? tagId : ''

  const groupOpener = useRef<HTMLButtonElement>(null)
  const client = useQueryClient()
  const listToggleRef = useRef<HTMLButtonElement>(null)
  const listCloseRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const inbox = useQuery(botInboxOptions(teamId))
  const [params, setParams] = useSearchParams()
  const isInbox = params.get('view') === 'inbox'
  const linkedTask = params.get('task') ?? undefined
  const linkedSkill = params.get('skill') ?? undefined
  const skillSearch = linkedSkill ? `?skill=${encodeURIComponent(linkedSkill)}` : ''
  const list = useInfiniteQuery(conversationsOptions(teamId, useDeferredValue(filter.trim()), activeTag || undefined))
  const rooms = list.data?.pages.flatMap(({ data }) => data.items) ?? []
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
        if (event.key === 'Escape' && listOpen && !newGroupOpen && !tagDialogOpen && !event.defaultPrevented)
          closeList()
      }}
    >
      <h1 className="sr-only">协作</h1>
      {listOpen && (
        <Button
          type="button"
          className="mobile-rooms-backdrop"
          variant="ghost"
          tabIndex={-1}
          aria-label="关闭会话列表"
          onClick={closeList}
        />
      )}
      <aside className="conversation-list" aria-label="会话列表" id="team-conversations">
        <div className="row conv-tools">
          <label className="search">
            <Search className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            <Input
              type="search"
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={filter}
              maxLength={80}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {!readOnly && (
            <Button
              ref={groupOpener}
              type="button"
              variant="ghost"
              size="icon"
              className="icon-btn"
              aria-label="新建群组"
              onClick={() => setNewGroupOpen(true)}
            >
              <Plus className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            </Button>
          )}
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
              <X className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          className={cn('inbox-link', isInbox && 'active')}
          aria-pressed={isInbox}
          onClick={() => {
            closeList()
            void navigate('/collaboration?view=inbox')
          }}
        >
          <Inbox className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
          待你处理
          {inbox.isSuccess && <span className="counter">{inbox.data.data.count}</span>}
        </Button>
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
            <Button ref={tagOpener} type="button" variant="ghost" onClick={() => setTagDialogOpen(true)}>
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
        {list.isPending && <DelayedPageSkeleton />}
        {list.isError && <PageError title="会话列表加载失败" error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && rooms.length === 0 && (
          <p className="small muted">{filter || activeTag ? '没有匹配的会话' : '还没有会话'}</p>
        )}
        {rooms.map((room) => (
          <Button
            key={room.id}
            type="button"
            className={cn('conversation-item', room.id === id && 'active')}
            variant="ghost"
            aria-pressed={room.id === id}
            onClick={() => {
              closeList()
              void navigate(`/collaboration/${room.id}${skillSearch}`)
            }}
          >
            <span className="conversation-mark">
              <Bot className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            </span>
            <span className="conversation-summary">
              <span className="conversation-title-row">
                <strong>{room.name}</strong>
                <time dateTime={room.lastMessageAt}>{clock.format(new Date(room.lastMessageAt))}</time>
              </span>
              <small>{room.kind === 'direct' ? '智能体私聊' : '群组'}</small>
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
      {id && !isInbox ? (
        <ConversationRoom
          key={`${id}:${linkedTask ?? ''}:${linkedSkill ?? ''}`}
          id={id}
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
              <Menu className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            </Button>
          </header>
          {isInbox ? (
            <BotInbox teamId={teamId} />
          ) : (
            <EmptyState
              icon={<MessagesSquare />}
              title="选择会话"
              description={
                linkedSkill
                  ? '选择已配置这项技能的会话，技能会带入输入框。'
                  : '从会话列表继续对话，或从智能体目录打开私聊。'
              }
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
      {newGroupOpen && (
        <NewGroupDialog
          teamId={teamId}
          userId={userId}
          onClose={() => {
            setNewGroupOpen(false)
            requestAnimationFrame(() => groupOpener.current?.focus())
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
