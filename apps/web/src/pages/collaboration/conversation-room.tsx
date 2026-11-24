import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { botTasksOptions, taskQueries } from '@/features/bot-tasks/api/queries'
import { ConversationTaskPanel } from '@/features/bot-tasks/ui/conversation-task-panel'
import { NewTaskDialog } from '@/features/bot-tasks/ui/new-task-dialog'
import {
  conversationEventsOptions,
  conversationEventText,
  conversationOptions,
  conversationsQueryKey,
  messagesOptions,
  type ConversationMessage,
  type ConversationEvents,
} from '@/features/conversations/api/queries'
import { conversationWork, type ConversationRun } from '@/features/conversations/model/conversation-trace'
import { ConversationAvatar } from '@/features/conversations/ui/conversation-avatar'
import { ConversationComposer } from '@/features/conversations/ui/conversation-composer'
import { ConversationIcon } from '@/features/conversations/ui/conversation-icon'
import { ConversationRelay } from '@/features/conversations/ui/conversation-relay'
import { ConversationMessages } from '@/features/conversations/ui/conversation-messages'
import type { MessageView } from '@/features/conversations/ui/conversation-message.view'
import {
  ConversationTrajectory,
  runElapsed,
  runLabels,
  useRunClock,
} from '@/features/conversations/ui/conversation-trajectory'
import { ConversationSettings } from '@/features/conversations/ui/conversation-settings'
import { Button } from '@/shared/ui/controls/button'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { PageError } from '@/shared/ui/page-state'
import { ConversationLoading, ConversationRoomSkeleton } from './conversation-loading'

const tabItems = [
  { id: 'chat', label: '对话' },
  { id: 'activity', label: '轨迹' },
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
  listToggle,
  initialTaskId,
  initialSkillId,
  onSkillUsed,
}: {
  id: string
  userId: string
  readOnly: boolean
  listToggle: ReactNode
  initialTaskId?: string
  initialSkillId?: string
  onSkillUsed: () => void
}) {
  const client = useQueryClient()
  const [tab, setTab] = useState('chat')
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
  const activeRelay = events.data ? events.data.activeRelay : detail.data?.data.activeRelay
  const running = events.data?.activeRuns.find(({ status }) => status === 'running')
  const stop = useMutation({
    mutationFn: async (runId: string) => {
      const options = { idempotencyKey: createIdempotencyKey() }
      if (activeRelay?.status === 'running') {
        await apiClient.controlBotRelay(activeRelay.id, 'stop', { version: activeRelay.version }, options)
      } else {
        await apiClient.stopBotRun(runId, options)
      }
    },
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

  if (detail.isPending) return <ConversationRoomSkeleton listToggle={listToggle} readOnly={readOnly} />
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
  const inputs = new Map<string, ConversationMessage>()
  const replies = new Map<string, ConversationMessage>()
  for (const message of stored) {
    if (!message.runId) continue
    if (message.speakerKind === 'user') inputs.set(message.runId, message)
    if (message.speakerKind === 'bot') replies.set(message.runId, message)
  }
  const progress = events.data?.progress ?? {}
  const active = new Map(events.data?.activeRuns.map((run) => [run.id, run]))
  const activity = events.data?.activity ?? []
  const runIds = new Set([...Object.keys(progress), ...active.keys(), ...inputs.keys(), ...replies.keys()])
  const runs = [...runIds].map<ConversationRun>((runId) => {
    const live = active.get(runId)
    const saved = progress[runId]
    const input = inputs.get(runId)
    const reply = replies.get(runId)
    const botId = live?.botId ?? saved?.botId ?? reply?.speakerId ?? leader?.id
    const status = reply ? 'succeeded' : (live?.status ?? saved?.status)
    const reason = live?.queueReason === 'worker_offline' ? '执行服务离线' : undefined
    const position = live?.teamQueuePosition ? `团队队列第 ${live.teamQueuePosition} 位` : undefined
    const label = saved?.stopRequested && status === 'running' ? '正在停止…' : runLabels[status ?? '']
    return {
      ...saved,
      id: runId,
      botId,
      name: reply?.speakerName ?? bots.find(({ id }) => id === botId)?.name ?? room.name,
      status,
      createdAt: input?.createdAt ?? saved?.createdAt ?? reply?.createdAt,
      statusText: [label, reason, position, saved?.failureMessage].filter(Boolean).join(' · '),
      text: saved?.text ?? '',
      input,
      reply,
    }
  })
  const runsById = new Map(runs.map((run) => [run.id, run]))
  const eventsByRun = new Map<string, ConversationEvents['items']>()
  for (const event of activity) {
    const group = eventsByRun.get(event.runId)
    if (group) group.push(event)
    else eventsByRun.set(event.runId, [event])
  }
  const workByRun = new Map(runs.map((run) => [run.id, conversationWork(run, eventsByRun.get(run.id) ?? [])]))

  const liveRun = running && runsById.get(running.id)
  const traceRun = liveRun ?? runs.slice().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
  const stopping = !!running && (liveRun?.stopRequested === true || stop.isPending)
  const memoryFor = (runId: string) =>
    (eventsByRun.get(runId) ?? []).flatMap(({ payload }) =>
      conversationEventText(payload, 'state') === 'memory_written'
        ? [conversationEventText(payload, 'action') ?? 'create']
        : [],
    )
  const items = stored.map<MessageView>((message) => {
    const run = message.runId ? runsById.get(message.runId) : undefined
    const botRun = message.speakerKind === 'bot' ? run : undefined
    return {
      id: message.id,
      kind: message.speakerKind,
      isStored: true,
      canEdit: room.kind === 'direct' && message.speakerKind === 'user' && message.speakerId === userId,
      branchSiblings: message.branchSiblings,
      templateName: message.body.references?.promptTemplate?.name,
      attachments: message.body.attachments,
      name: message.speakerName ?? '会话通知',
      time: message.createdAt,
      text: message.body.blocks.flatMap((block) => (block.type === 'tool_activity' ? [] : [block.text])).join('\n\n'),
      runId: message.speakerKind === 'bot' && message.runId ? message.runId : undefined,
      status: botRun?.status,
      elapsed: botRun ? runElapsed(botRun, now) : undefined,
      workSteps: botRun && workByRun.get(botRun.id)?.steps,
      metrics: message.body.metrics,
      feedback: message.feedback,
      memoryChanges: message.speakerKind === 'bot' && message.runId ? memoryFor(message.runId) : undefined,
      // 失败的运行不会提交助手消息，原因挂在触发消息下，避免空状态条一直停在消息末尾。
      failureText:
        message.speakerKind === 'user' &&
        run?.status === 'failed' &&
        !workByRun.get(run.id)?.steps.length &&
        !workByRun.get(run.id)?.partialText
          ? run.statusText
          : undefined,
    }
  })
  const ongoing = runs.flatMap<MessageView>((run) => {
    if (!run.status || run.reply || run.status === 'succeeded') return []
    const work = workByRun.get(run.id)
    const isTerminal = !['running', 'queued'].includes(run.status)
    if (isTerminal && !work?.steps.length && !work?.partialText) return []
    return [
      {
        id: run.id,
        runId: run.id,
        name: run.name,
        kind: 'bot',
        time: run.createdAt,
        text: work?.partialText ?? '',
        workSteps: work?.steps,
        status: run.status,
        statusText: stopping && run.id === running?.id ? '正在停止…' : run.statusText,
        elapsed: runElapsed(run, now),
        memoryChanges: memoryFor(run.id),
      },
    ]
  })
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
  return (
    <>
      <Tabs className="conversation-main dsh-chat gap-0" value={tab} onValueChange={setTab} aria-label="当前会话">
        <header className="dsh-chat-header">
          <div className="dsh-title-row">
            {listToggle}
            {!readOnly ? (
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
            </div>
          </div>
          <TabsList unstyled className="dsh-tabs" aria-label="会话视图">
            {tabItems.map(({ id, label }) => (
              <TabsTrigger key={id} value={id} variant="unstyled" className="dsh-tab rounded-sm" aria-label={label}>
                <span className="dsh-tab-label">{label}</span>
                {id === 'activity' && liveRun && <span className="dsh-tab-pulse" aria-hidden="true" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </header>
        <TabsContent value="chat" forceMount className="dsh-scroll-area">
          {messages.isPending && <ConversationLoading message="正在加载消息…" />}
          {messages.isError && (
            <PageError title="消息加载失败" error={messages.error} onRetry={() => void messages.refetch()} />
          )}
          {messages.isSuccess && (
            <ConversationMessages
              items={[...items, ...ongoing]}
              roomName={room.name}
              showBotNames={room.kind === 'group'}
              intro={room.responsibility || leader?.responsibility}
              avatar={avatar}
              hasEarlier={messages.hasNextPage}
              loadingEarlier={messages.isFetchingNextPage}
              loadEarlier={() => void messages.fetchNextPage()}
              conversationId={room.id}
              readOnly={readOnly}
              busy={active.size > 0}
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
          {activeRelay && (
            <ConversationRelay
              relay={activeRelay}
              readOnly={readOnly}
              hasRunningReply={Boolean(running)}
              onChange={() => void events.refetch()}
            />
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
          <div className="dsh-panel-scroll conversation-trace-scroll">
            {!traceRun && (events.isPending || messages.isPending) ? (
              <ConversationLoading message="正在加载轨迹…" />
            ) : !traceRun && (events.isError || messages.isError) ? (
              <PageError
                title="轨迹加载失败"
                error={events.error ?? messages.error}
                onRetry={() => void Promise.all([events.refetch(), messages.refetch()])}
              />
            ) : (
              <ConversationTrajectory
                conversationId={id}
                run={traceRun}
                now={now}
                onStop={!readOnly && running && !stopping ? (runId) => stop.mutate(runId) : undefined}
                stopError={stop.isError ? describeRequestError(stop.error).description : undefined}
              />
            )}
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
      {panel === 'settings' && (
        <ConversationSettings
          room={room}
          userId={userId}
          avatar={avatar}
          onClose={closePanel}
          readOnly={readOnly}
          busy={active.size > 0}
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
