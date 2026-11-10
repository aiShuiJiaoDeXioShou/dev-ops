import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { getSession } from './auth-client'

/** 当前认证会话；未登录时 data 为 null。 */
export const sessionQueryOptions = queryOptions({
  queryKey: ['identity', 'session'],
  queryFn: () => getSession(),
  staleTime: 30_000,
  retry: false,
})

/** 当前用户加入的团队。 */
export const myTeamsQueryOptions = queryOptions({
  queryKey: ['identity', 'teams'],
  queryFn: ({ signal }) => apiClient.listMyTeams({ signal }),
  staleTime: 30_000,
})
