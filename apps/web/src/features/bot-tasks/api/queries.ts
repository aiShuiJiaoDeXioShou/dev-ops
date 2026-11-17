import type { ApiSuccessData } from '@dev-ops/api-client'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

export type BotTaskDetail = ApiSuccessData<'/api/v1/bot-tasks/{taskId}', 'get'>
export type BotTaskStatus = BotTaskDetail['status']

export const taskStatusLabels: Record<BotTaskStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  waiting: '等待中',
  awaiting_review: '待验收',
  completed: '已完成',
  cancelled: '已取消',
}

export const taskQueries = ['bot-tasks']

/** 分页读取会话任务，带运行的会话由上层刷新。 */
export function botTasksOptions(id: string) {
  return infiniteQueryOptions({
    queryKey: [...taskQueries, 'list', id],
    queryFn: ({ signal, pageParam }) => apiClient.listBotTasks(id, { cursor: pageParam || undefined }, { signal }),
    initialPageParam: '',
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })
}

/** 读取任务的当前版本、输入与运行轨迹。 */
export function botTaskOptions(id: string) {
  return queryOptions({
    queryKey: [...taskQueries, 'detail', id],
    queryFn: ({ signal }) => apiClient.getBotTask(id, { signal }),
  })
}
