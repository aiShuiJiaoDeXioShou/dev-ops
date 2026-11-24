import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export const taskQueries = ['bot-tasks']

/** 读取当前成员可见且等待回复的会话汇总，每十秒刷新。 */
export function botInboxOptions(teamId: string) {
  return queryOptions({
    queryKey: [...taskQueries, 'inbox', teamId],
    queryFn: ({ signal }) => apiClient.getBotInbox(teamId, { signal }),
    refetchInterval: 10_000,
  })
}
