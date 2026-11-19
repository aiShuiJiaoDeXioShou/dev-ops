import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import type { BotConversation } from '../api/queries'

/**
 * 显示当前群聊接力的实际计数，并为可写成员提供暂停后的操作。
 * @param props 接力状态、只读权限、是否已有停止入口及更新回调。
 * @returns 精简的会话状态行。
 */
export function ConversationRelay({
  relay,
  readOnly,
  hasRunningReply,
  onChange,
}: {
  relay: NonNullable<BotConversation['activeRelay']>
  readOnly: boolean
  hasRunningReply: boolean
  onChange: () => void
}) {
  const mutation = useMutation({
    mutationFn: (action: 'continue' | 'end' | 'stop') =>
      apiClient.controlBotRelay(
        relay.id,
        action,
        { version: relay.version },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: onChange,
  })
  const paused = relay.status === 'paused'
  const status = paused ? '接力暂停' : '接力进行中'
  return (
    <section className="dsh-running flex-wrap" aria-label="群聊接力">
      <GitBranch className="size-4" aria-hidden="true" />
      <span role="status">
        {status} · {relay.hopCount}/{relay.hopLimit} 跳 · {relay.replyCount}/{relay.replyLimit} 条回复
      </span>
      <span className="spacer" />
      {!readOnly && paused && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate('end')}
          >
            结束接力
          </Button>
          <Button
            type="button"
            size="sm"
            aria-busy={mutation.isPending}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate('continue')}
          >
            继续接力
          </Button>
        </>
      )}
      {!readOnly && !paused && !hasRunningReply && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-busy={mutation.isPending}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('stop')}
        >
          停止接力
        </Button>
      )}
      {mutation.isError && (
        <p className="field-error" role="alert">
          {describeRequestError(mutation.error).description}
        </p>
      )}
    </section>
  )
}
