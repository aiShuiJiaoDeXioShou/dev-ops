import type { ApiSuccessData } from '@dev-ops/api-client'
import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

const POLL_WHILE_ACTIVE_MS = 1000
const POLL_WHILE_IDLE_MS = 10_000
const POLL_EVENT_BACKLOG_MS = 150
const EVENT_PAGE_SIZE = 100

export type BotConversation = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
export type ConversationMessage = ApiSuccessData<
  '/api/v1/bot-conversations/{conversationId}/messages',
  'get'
>['items'][number]
export type ConversationEvents = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/events', 'get'>
type RunProgress = {
  text: string
  botId?: string
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  firstOutputAt?: string
  stopRequested?: boolean
  status?: string
  failureMessage?: string
}
type EventState = {
  cursor: string
  activeRuns: ConversationEvents['activeRuns']
  progress: Record<string, RunProgress>
  activity: ConversationEvents['items']
  hasMore: boolean
}

export const conversationsQueryKey = ['bot-conversations']

/** 分页列出指定团队中当前成员可见的会话。 */
export function conversationsOptions(teamId: string, query: string, tagId?: string) {
  return infiniteQueryOptions({
    queryKey: [...conversationsQueryKey, teamId, query, tagId],
    queryFn: ({ signal, pageParam }) =>
      apiClient.listBotConversations(teamId, { query, tagId, cursor: pageParam || undefined }, { signal }),
    initialPageParam: '',
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
    refetchInterval: POLL_WHILE_IDLE_MS,
  })
}

/** 读取当前成员可见的会话详情。 */
export function conversationOptions(id: string) {
  return queryOptions({
    queryKey: ['bot-conversation', id],
    queryFn: ({ signal }) => apiClient.getBotConversation(id, { signal }),
  })
}

/** 从最近的消息向前分页，调用方按序号显示。 */
export function messagesOptions(id: string) {
  return infiniteQueryOptions({
    queryKey: ['bot-messages', id],
    queryFn: ({ signal, pageParam }) => apiClient.listBotMessages(id, { before: pageParam || undefined }, { signal }),
    initialPageParam: '',
    getNextPageParam: ({ data }) => data.nextBefore ?? undefined,
  })
}

/**
 * 安全读取会话事件的可展示文本。
 * @param payload 服务端按事件类型返回的载荷。
 * @param property 需要的字段名。
 * @returns 字段为文本时返回内容，否则返回 undefined。
 */
export function conversationEventText(payload: unknown, property: string) {
  if (!payload || typeof payload !== 'object') return undefined
  const value: unknown = Reflect.get(payload, property)
  return typeof value === 'string' ? value : undefined
}

/** 按事件游标更新运行状态与增量正文；最终消息从历史记录重新同步。 */
export function conversationEventsOptions(client: QueryClient, id: string) {
  const queryKey = ['bot-conversation-events', id]
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<EventState> => {
      const cached = client.getQueryData<EventState>(queryKey)
      const { data } = await apiClient.listBotConversationEvents(id, { after: cached?.cursor }, { signal })
      const progress = { ...(data.resetRequired ? undefined : cached?.progress) }
      const activity = data.resetRequired ? [] : [...(cached?.activity ?? [])]
      let shouldReloadMessages = data.resetRequired
      for (const event of data.items) {
        if (event.kind === 'tool_activity') activity.push(event)
        if (event.kind === 'message_committed') {
          const run = progress[event.runId]
          if (run) progress[event.runId] = { ...run, text: '' }
          shouldReloadMessages = true
        }
        if (event.kind === 'run_status' || event.kind === 'output_delta') {
          const entry = progress[event.runId] ?? { text: '' }
          const status = conversationEventText(event.payload, 'status') ?? entry.status
          const isFinished = status === 'succeeded' || status === 'failed' || status === 'stopped'
          const payload = event.payload
          const stopRequested =
            payload && typeof payload === 'object' ? Reflect.get(payload, 'stopRequested') : undefined
          progress[event.runId] = {
            text: entry.text + (conversationEventText(event.payload, 'text') ?? ''),
            createdAt: entry.createdAt ?? event.createdAt,
            startedAt: entry.startedAt ?? (status === 'running' ? event.createdAt : undefined),
            finishedAt: entry.finishedAt ?? (isFinished ? event.createdAt : undefined),
            firstOutputAt: entry.firstOutputAt ?? (event.kind === 'output_delta' ? event.createdAt : undefined),
            botId: conversationEventText(event.payload, 'botId') ?? entry.botId,
            stopRequested: typeof stopRequested === 'boolean' ? stopRequested : entry.stopRequested,
            status,
            failureMessage: conversationEventText(event.payload, 'failureMessage') ?? entry.failureMessage,
          }
        }
      }
      if (shouldReloadMessages) {
        await client.invalidateQueries({ queryKey: messagesOptions(id).queryKey })
      }
      return {
        cursor: data.cursor,
        activeRuns: data.activeRuns,
        progress: Object.fromEntries(Object.entries(progress).slice(-200)),
        activity: activity.slice(-100),
        hasMore: data.items.length >= EVENT_PAGE_SIZE,
      }
    },
    refetchInterval: ({ state }) => {
      if (state.data?.hasMore) return POLL_EVENT_BACKLOG_MS
      return state.data?.activeRuns.length ? POLL_WHILE_ACTIVE_MS : POLL_WHILE_IDLE_MS
    },
  })
}
