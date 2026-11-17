import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

export type BotView = ApiSuccessData<'/api/v1/bots/{botId}', 'get'>
export type BotRunView = ApiSuccessData<'/api/v1/bots/{botId}/runs', 'get'>['items'][number]
export type BotFilters = ApiQuery<'/api/v1/teams/{teamId}/bots', 'get'>

export const botQueryKey = ['bots']

/** 查询当前团队的 Bot，筛选与翻页期间保留旧列表。 */
export function botListQueryOptions(teamId: string, filters: BotFilters) {
  return queryOptions({
    queryKey: [...botQueryKey, 'list', teamId, filters],
    queryFn: ({ signal }) => apiClient.listBots(teamId, filters, { signal }),
    placeholderData: keepPreviousData,
  })
}

/** 加载 Bot 配置和模型可用性。 */
export function botDetailQueryOptions(botId: string) {
  return queryOptions({
    queryKey: [...botQueryKey, 'detail', botId],
    queryFn: ({ signal }) => apiClient.getBot(botId, { signal }),
    enabled: Boolean(botId),
  })
}

/** 查询当前用户可见会话中的运行记录。 */
export function botRunsQueryOptions(botId: string, cursor?: string) {
  return queryOptions({
    queryKey: [...botQueryKey, 'runs', botId, cursor],
    queryFn: ({ signal }) => apiClient.listBotRuns(botId, { cursor }, { signal }),
    placeholderData: keepPreviousData,
  })
}

/** 分页查询选择器所需的团队 Bot。 */
export function botChoicesOptions(teamId: string) {
  return infiniteQueryOptions({
    queryKey: [...botQueryKey, 'choices', teamId],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => apiClient.listBots(teamId, { cursor: pageParam || undefined }, { signal }),
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })
}
