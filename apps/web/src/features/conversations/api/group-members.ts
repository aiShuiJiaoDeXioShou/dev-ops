import { infiniteQueryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { botQueryKey } from '@/features/bots/api/queries'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
import { apiClient } from '@/shared/api/client'

/** 加载当前团队可选的智能体与有效成员。 */
export function useGroupMemberChoices(teamId: string) {
  const bots = useInfiniteQuery(
    infiniteQueryOptions({
      queryKey: [...botQueryKey, 'group-members', teamId],
      initialPageParam: '',
      queryFn: ({ signal, pageParam }) => apiClient.listBots(teamId, { cursor: pageParam || undefined }, { signal }),
      getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
    }),
  )
  const users = useQuery(teamMembersQueryOptions(teamId))
  return {
    bots: bots.data?.pages.flatMap(({ data }) => data.items) ?? [],
    users: users.data?.data.filter(({ status }) => status === 'active') ?? [],
    error: bots.error ?? users.error,
    pending: bots.isPending || users.isPending,
    more: bots.hasNextPage,
    loadingMore: bots.isFetchingNextPage,
    loadMore: () => void bots.fetchNextPage(),
    retry: () => void Promise.all([bots.refetch(), users.refetch()]),
  }
}
