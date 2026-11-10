import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import type { CollabTarget } from './queries'

/** 追加评论并刷新对应事项评论。 */
export function useAddComment(target: CollabTarget, targetId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (bodyMarkdown: string) =>
      target === 'requirement'
        ? apiClient.addRequirementComment(targetId, { bodyMarkdown }, { idempotencyKey: createIdempotencyKey() })
        : apiClient.addBugComment(targetId, { bodyMarkdown }, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collaboration', 'comments', target, targetId] }),
  })
}
