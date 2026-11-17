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
export function conversationsOptions(teamId: string, query: string) {
  return infiniteQueryOptions({
    queryKey: [...conversationsQueryKey, teamId, query],
    queryFn: ({ signal, pageParam }) =>
      apiClient.listBotConversations(teamId, { query, cursor: pageParam || undefined }, { signal }),
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

function stringProperty(payload: unknown, property: string) {
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
          delete progress[event.runId]
          shouldReloadMessages = true
        }
        if (event.kind === 'run_status' || event.kind === 'output_delta') {
          const entry = progress[event.runId] ?? { text: '' }
          progress[event.runId] = {
            text: entry.text + (stringProperty(event.payload, 'text') ?? ''),
            status: stringProperty(event.payload, 'status') ?? entry.status,
            failureMessage: stringProperty(event.payload, 'failureMessage') ?? entry.failureMessage,
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
