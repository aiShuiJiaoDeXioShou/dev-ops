import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export const botMemoryKey = ['bot-memories']
export type BotMemory = ApiSuccessData<'/api/v1/teams/{teamId}/bot-memories', 'get'>['items'][number]
export type BotMemoryFilters = Omit<ApiQuery<'/api/v1/teams/{teamId}/bot-memories', 'get'>, 'cursor'>

/** 分页读取当前团队中可见的长期记忆。 */
export function botMemoryOptions(teamId: string, filters: BotMemoryFilters) {
  return infiniteQueryOptions({
    queryKey: [...botMemoryKey, teamId, filters],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      apiClient.listBotMemories(teamId, { ...filters, cursor: pageParam || undefined }, { signal }),
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })
}
