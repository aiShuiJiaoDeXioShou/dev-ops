import { useEffect, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { botTasksOptions, taskQueries } from '@/features/bot-tasks/api/queries'
import { ConversationTaskPanel } from '@/features/bot-tasks/ui/conversation-task-panel'
import { NewTaskDialog } from '@/features/bot-tasks/ui/new-task-dialog'
import {
  conversationEventsOptions,
  conversationEventText,
  conversationOptions,
  conversationsQueryKey,
  messagesOptions,
} from '@/features/conversations/api/queries'
import { ConversationAvatar } from '@/features/conversations/ui/conversation-avatar'
import { ConversationComposer } from '@/features/conversations/ui/conversation-composer'
import { ConversationIcon } from '@/features/conversations/ui/conversation-icon'
import { ConversationMessages, type MessageView } from '@/features/conversations/ui/conversation-messages'
import {
  ConversationTrajectory,
  runElapsed,
  runLabels,
  useRunClock,
  type ConversationRun,
} from '@/features/conversations/ui/conversation-trajectory'
import { GroupSettings } from '@/features/conversations/ui/group-settings'
import { WorkTagEditor } from '@/features/work-tags/ui/work-tag-editor'
import { Button } from '@/shared/ui/controls/button'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'

const tabItems = [
  { id: 'chat', label: '对话' },
  { id: 'activity', label: '轨迹' },
  { id: 'context', label: '上下文' },
]

/**
 * 展示真实会话的原型布局及运行状态，由外层负责导航和会话切换。
 * @param props 当前会话、用户权限、窄屏列表入口及待打开的任务或技能。
 * @returns 会话主体和当前展开的右栏。
 */
export function ConversationRoom({
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
  const [tab, setTab] = useState('chat')
  const [traceId, setTraceId] = useState<string>()
  const [panel, setPanel] = useState<'task' | 'settings' | null>(initialTaskId ? 'task' : null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [taskId, setTaskId] = useState(initialTaskId)
  const taskOpener = useRef<HTMLButtonElement>(null)
  const settingsOpener = useRef<HTMLElement>(null)
  const newTaskOpener = useRef<HTMLElement>(null)
  const detail = useQuery({ ...conversationOptions(id), refetchInterval: 10000 })
  const messages = useInfiniteQuery({ ...messagesOptions(id), enabled: detail.isSuccess })
  const events = useQuery({ ...conversationEventsOptions(client, id), enabled: detail.isSuccess })
  const tasks = useInfiniteQuery({ ...botTasksOptions(id), enabled: detail.isSuccess })
  const running = events.data?.activeRuns.find(({ status }) => status === 'running')
  const stop = useMutation({
    mutationFn: (runId: string) => apiClient.stopBotRun(runId, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: () => {
      void events.refetch()
    },
  })
  const now = useRunClock(!!running)
  const taskPanelOpen = panel === 'task'
  const closePanel = () => {
    setPanel(null)
    if (panel === 'settings') settingsOpener.current?.focus()
    if (panel === 'task') taskOpener.current?.focus()
  }

  useEffect(() => {
    if (!panel || newTaskOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== 'Escape' ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
      )
        return
      setPanel(null)
      if (panel === 'task') taskOpener.current?.focus()
      else settingsOpener.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [panel, newTaskOpen])
  useEffect(() => {
    if (events.data?.cursor && events.data.cursor !== '0') {
      void client.invalidateQueries({ queryKey: taskQueries })
    }
  }, [client, events.data?.cursor])

  if (detail.isPending) return <DelayedPageSkeleton />
  if (detail.isError)
    return <PageError title="会话加载失败" error={detail.error} onRetry={() => void detail.refetch()} />
  const room = detail.data.data
  const tasksInRoom = tasks.data?.pages.flatMap(({ data }) => data.items) ?? []
  const currentTask = tasksInRoom.find((task) => task.id === taskId)
  const editableTask =
    taskPanelOpen && currentTask && ['waiting', 'in_progress', 'pending'].includes(currentTask.status)
      ? currentTask
      : undefined
  const bots = room.members.filter(({ kind }) => kind === 'bot')
  const leader = bots.find(({ id }) => id === room.leaderBotId) ?? bots[0]
  const orderedBots = leader ? [leader, ...bots.filter(({ id }) => id !== leader.id)] : bots
  const avatar = <ConversationAvatar kind={room.kind} bots={orderedBots} />
  const stored =
    messages.data?.pages
      .slice()
      .reverse()
      .flatMap(({ data }) => data.items) ?? []
  const finalRuns = new Set(stored.flatMap((item) => (item.speakerKind === 'bot' && item.runId ? [item.runId] : [])))
  const progress = events.data?.progress ?? {}
  const active = new Map(events.data?.activeRuns.map((run) => [run.id, run]))
  const activity = events.data?.activity ?? []
  const runs = [...new Set([...Object.keys(progress), ...active.keys()])].map<ConversationRun>((runId) => {
    const live = active.get(runId)
    const saved = progress[runId]
    const botId =
      live?.botId ??
      saved?.botId ??
      stored.find((item) => item.runId === runId && item.speakerKind === 'bot')?.speakerId ??
      leader?.id
    const status = live?.status ?? saved?.status
    const reason = live?.queueReason === 'worker_offline' ? '执行服务离线' : undefined
    const position = live?.teamQueuePosition ? `团队队列第 ${live.teamQueuePosition} 位` : undefined
    const label = saved?.stopRequested && status === 'running' ? '正在停止…' : runLabels[status ?? '']
    return {
      ...saved,
      id: runId,
      botId,
      name: bots.find(({ id }) => id === botId)?.name ?? room.name,
      status,
      statusText: [label, reason, position, saved?.failureMessage].filter(Boolean).join(' · '),
      text: saved?.text ?? '',
    }
  })
  const runsById = new Map(runs.map((run) => [run.id, run]))
  const liveRun = running && runsById.get(running.id)
  const stopping = !!running && (liveRun?.stopRequested === true || stop.isPending || stop.data?.data.id === running.id)
  const liveTools = activity.filter(
    ({ runId, payload }) => runId === running?.id && conversationEventText(payload, 'state') === 'finished',
  ).length
  const memoryFor = (runId: string) =>
    activity.flatMap(({ runId: id, payload }) =>
      id === runId && conversationEventText(payload, 'state') === 'memory_written'
        ? [conversationEventText(payload, 'action') ?? 'create']
        : [],
    )
  const items = stored.map<MessageView>((message) => {
    const run = message.runId && message.speakerKind === 'bot' ? runsById.get(message.runId) : undefined
    return {
      id: message.id,
      kind: message.speakerKind,
      name: message.speakerName ?? '会话通知',
      time: message.createdAt,
      bot:
        message.speakerKind === 'bot'
          ? (bots.find(({ id }) => id === message.speakerId) ??
            (message.speakerId ? { id: message.speakerId } : undefined))
          : undefined,
      text: message.body.blocks.flatMap((block) => (block.type === 'tool_activity' ? [] : [block.text])).join('\n\n'),
      runId: message.speakerKind === 'bot' && message.runId ? message.runId : undefined,
      status: run?.status,
      elapsed: run ? runElapsed(run, now) : undefined,
      memoryChanges: message.speakerKind === 'bot' && message.runId ? memoryFor(message.runId) : undefined,
    }
  })
  const ongoing = runs.flatMap<MessageView>((run) => {
    if (!run.status || finalRuns.has(run.id) || run.status === 'succeeded') return []
    return [
      {
        id: run.id,
        runId: run.id,
        name: run.name,
        kind: 'bot',
        time: run.createdAt,
        bot: bots.find(({ id }) => id === run.botId) ?? (run.botId ? { id: run.botId } : undefined),
        text: run.text,
        status: run.status,
        statusText: run.statusText,
        elapsed: runElapsed(run, now),
        memoryChanges: memoryFor(run.id),
      },
    ]
  })
  function showTrace(runId: string) {
    setTraceId(runId)
    setTab('activity')
  }
  function openTask() {
    if (taskPanelOpen) {
      closePanel()
      return
    }
    const activeTask = tasksInRoom.find(({ status }) => !['completed', 'cancelled'].includes(status))
    setTaskId(activeTask?.id)
    setPanel('task')
  }
  function openSettings(opener: HTMLElement) {
    settingsOpener.current = opener
    if (panel === 'settings') closePanel()
    else setPanel('settings')
  }
  function createTask(opener?: HTMLElement) {
    newTaskOpener.current = opener ?? taskOpener.current
    setNewTaskOpen(true)
  }
  const title = (
    <>
      <span className="dsh-title-avatar">{avatar}</span>
      <span className="dsh-title-text">
        <strong>{room.name}</strong>
        <small>
          {room.kind === 'group'
            ? `${bots.length} 位 Bot · Leader ${leader?.name ?? '未设置'}`
            : leader?.responsibility || '智能体'}
          {room.tags.length > 0 && ' · '}
          {room.tags.map(({ id, name }) => (
            <span className="project-tag" key={id}>
              #{name}{' '}
            </span>
          ))}
        </small>
      </span>
    </>
  )
  const counts: Record<string, number> = {
    activity: runs.length,
    context: room.tags.length + room.skillReferences.length,
  }
  return (
    <>
      <Tabs className="conversation-main dsh-chat gap-0" value={tab} onValueChange={setTab} aria-label="当前会话">
        <header className="dsh-chat-header">
          <div className="dsh-title-row">
            <Button
              unstyled
              ref={listToggleRef}
              type="button"
              className="dsh-icon-btn dsh-room-toggle"
              aria-label="打开会话列表"
              aria-expanded={listOpen}
              aria-controls="team-conversations"
              onClick={openList}
            >
              <ConversationIcon name="menu" />
            </Button>
            {!readOnly && room.kind === 'group' ? (
              <Button
                unstyled
                type="button"
                className="dsh-title"
                aria-label={`${room.name}的会话设置`}
                onClick={(event) => openSettings(event.currentTarget)}
              >
                {title}
              </Button>
            ) : (
              <div className="dsh-title">{title}</div>
            )}
            <div className="dsh-title-actions">
              {liveRun && (
                <span className="dsh-running-pill">
                  <span className="dsh-pulse" aria-hidden="true" />
                  {liveRun.statusText}
                </span>
              )}
              <Button
                unstyled
                ref={taskOpener}
                type="button"
                className="dsh-icon-btn"
                aria-label="任务列表"
                aria-pressed={taskPanelOpen}
                title="任务列表"
                onClick={openTask}
              >
                <ConversationIcon name="file" />
                {tasksInRoom.length > 0 && (
                  <span className="dsh-icon-badge">
                    {tasksInRoom.length}
                    {tasks.hasNextPage ? '+' : ''}
                  </span>
                )}
              </Button>
              {!readOnly && room.kind === 'group' && (
                <Button
                  unstyled
                  type="button"
                  className="dsh-icon-btn"
                  aria-label="会话设置"
                  aria-pressed={panel === 'settings'}
                  title="会话设置"
                  onClick={(event) => openSettings(event.currentTarget)}
                >
                  <ConversationIcon name="settings" />
                </Button>
              )}
            </div>
          </div>
          <div className="dsh-tabs-row">
            <TabsList unstyled className="dsh-tabs" aria-label="会话视图">
              {tabItems.map(({ id, label }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  variant="unstyled"
                  className="dsh-tab rounded-sm focus-visible:ring-inset"
                  aria-label={label}
                >
                  <span className="dsh-tab-label">{label}</span>
                  {!!counts[id] && (
                    <span className="dsh-tab-count" aria-hidden="true">
                      {counts[id]}
                    </span>
                  )}
                  {id === 'activity' && liveRun && <span className="dsh-tab-pulse" aria-hidden="true" />}
                </TabsTrigger>
              ))}
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button unstyled type="button" className="dsh-tab-more" aria-label="更多会话操作">
                  <ConversationIcon name="more" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={openTask}>会话任务</DropdownMenuItem>
                {!readOnly && <DropdownMenuItem onSelect={() => createTask()}>新建任务</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setTab('context')}>工作标签</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <TabsContent value="chat" forceMount className="dsh-scroll-area">
          {messages.isPending && <DelayedPageSkeleton />}
          {messages.isError && (
            <PageError title="消息加载失败" error={messages.error} onRetry={() => void messages.refetch()} />
          )}
          {messages.isSuccess && (
            <ConversationMessages
              items={[...items, ...ongoing]}
              roomName={room.name}
              intro={room.responsibility || leader?.responsibility}
              avatar={avatar}
              hasEarlier={messages.hasNextPage}
              loadingEarlier={messages.isFetchingNextPage}
              loadEarlier={() => void messages.fetchNextPage()}
              onTrace={showTrace}
              isVisible={tab === 'chat'}
            />
          )}
          {events.isError && (
            <div className="row dsh-readonly-note" role="status">
              运行状态更新失败{' '}
              <Button variant="ghost" type="button" onClick={() => void events.refetch()}>
                重试
              </Button>
            </div>
          )}
          {stop.isError && (
            <p className="dsh-readonly-note" role="alert">
              {describeRequestError(stop.error).description}
            </p>
          )}
          {liveRun && (
            <div className="dsh-running" role="status">
              <span className="dsh-pulse" aria-hidden="true" />
              <span className="dsh-running-label">{stopping ? '正在停止…' : liveRun.statusText}</span>
              <span className="dsh-running-time" aria-hidden="true">
                {runElapsed(liveRun, now)}
              </span>
              {liveTools > 0 && (
                <>
                  <span className="dsh-sep" aria-hidden="true" />
                  <span className="dsh-running-steps">{liveTools} 次工具调用</span>
                </>
              )}
              <span className="spacer" />
              <Button unstyled type="button" className="dsh-link" onClick={() => showTrace(liveRun.id)}>
                查看轨迹
              </Button>
            </div>
          )}
          <ConversationComposer
            room={room}
            readOnly={readOnly}
            initialSkillId={initialSkillId}
            runningId={running?.id}
            isStopping={stopping}
            onStop={(runId) => stop.mutate(runId)}
            task={editableTask}
            onNewTask={(opener) => createTask(opener ?? undefined)}
            onSent={() => {
              if (initialSkillId) onSkillUsed()
              void Promise.all([
                client.invalidateQueries({ queryKey: messagesOptions(id).queryKey }),
                client.invalidateQueries({ queryKey: conversationsQueryKey }),
                client.invalidateQueries({ queryKey: taskQueries }),
                events.refetch(),
              ])
            }}
          />
        </TabsContent>
        <TabsContent value="activity" className="dsh-tab-panel">
          <div className="dsh-panel-scroll">
            {events.isPending ? (
              <DelayedPageSkeleton />
            ) : events.isError ? (
              <PageError title="轨迹加载失败" error={events.error} onRetry={() => void events.refetch()} />
            ) : (
              <ConversationTrajectory
                key={traceId}
                runs={runs.slice().reverse()}
                events={activity}
                selectedId={traceId}
                onSelect={setTraceId}
                now={now}
                onStop={!readOnly && running && !stopping ? (runId) => stop.mutate(runId) : undefined}
                stopError={stop.isError ? describeRequestError(stop.error).description : undefined}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="context" className="dsh-tab-panel">
          <div className="dsh-panel-scroll">
            <section className="ctx-wrap">
              <div className="dsh-panel-head">
                <div>
                  <strong>上下文</strong>
                  <span className="dsh-panel-meta">
                    {room.tags.length} 个工作标签 · {room.skillReferences.length} 项可引用技能
                  </span>
                </div>
              </div>
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
              {(room.responsibility || room.instructions) && (
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
              )}
              {room.skillReferences.length > 0 && (
                <ul className="ctx-list">
                  {room.skillReferences.map(({ id, name, identifier, summary }) => (
                    <li key={id} className="ctx-row">
                      <span className="ctx-icon">
                        <ConversationIcon name="layers" />
                      </span>
                      <span className="ctx-title">
                        <Link to={`/capabilities/skills/${id}`}>{name}</Link>
                        <small>
                          @{identifier} · {summary}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </TabsContent>
      </Tabs>
      {taskPanelOpen && (
        <ConversationTaskPanel
          room={room}
          taskId={taskId}
          readOnly={readOnly}
          onClose={closePanel}
          onNew={() => {
            const active = document.activeElement
            createTask(active instanceof HTMLElement ? active : undefined)
          }}
          onSelect={setTaskId}
          onChanged={() => void events.refetch()}
        />
      )}
      {panel === 'settings' && <GroupSettings room={room} userId={userId} onClose={closePanel} />}
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
            setPanel('task')
            setTaskId(createdTask)
            void client.invalidateQueries({ queryKey: taskQueries })
            void events.refetch()
          }}
        />
      )}
    </>
  )
}
