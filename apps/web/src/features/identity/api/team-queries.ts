import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

/** 团队成员列表。 */
export function teamMembersQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: ['identity', 'members', teamId],
    queryFn: ({ signal }) => apiClient.listTeamMembers(teamId, { signal }),
    enabled: Boolean(teamId),
  })
}

/** 团队邀请列表。 */
export function teamInvitationsQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: ['identity', 'invitations', teamId],
    queryFn: ({ signal }) => apiClient.listTeamInvitations(teamId, { status: 'pending' }, { signal }),
    enabled: Boolean(teamId),
  })
}
