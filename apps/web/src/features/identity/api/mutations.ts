import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { signInEmail, signOut } from './auth-client'
import { sessionQueryOptions } from './queries'

/** 登录并刷新会话缓存。 */
export function useSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => signInEmail(email, password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey }),
  })
}

/** 退出并清空会话缓存。 */
export function useSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => queryClient.clear(),
  })
}

/** 成员角色/状态更新。 */
export function useUpdateMember(teamId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      role,
      status,
    }: {
      userId: string
      role?: 'admin' | 'developer' | 'viewer'
      status?: 'active' | 'disabled'
    }) => apiClient.updateTeamMember(teamId, userId, { role, status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['identity', 'members', teamId] }),
  })
}
