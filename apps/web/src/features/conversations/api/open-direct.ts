import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { conversationOptions, conversationsQueryKey } from './queries'

/**
 * 创建或打开团队私聊，以服务端返回的详情进入会话并刷新列表。
 * @param teamId 智能体所属团队。
 * @param skillId 进入对话时可预填引用的技能。
 * @returns 接收智能体标识的请求及提交状态；失败时由调用方展示错误。
 */
export function useOpenDirectConversation(teamId: string, skillId?: string) {
  const client = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (botId: string) =>
      apiClient.createBotConversation(teamId, { kind: 'direct', botId }, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: async (response) => {
      const { id } = response.data
      client.setQueryData(conversationOptions(id).queryKey, response)
      await client.invalidateQueries({ queryKey: [...conversationsQueryKey, teamId], refetchType: 'none' })
      const search = skillId ? `?${new URLSearchParams({ skill: skillId })}` : ''
      void navigate(`/collaboration/${id}${search}`)
    },
  })
}
