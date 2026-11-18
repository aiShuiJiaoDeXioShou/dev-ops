import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, Check, Copy, Database, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/controls/popover'
import { useToast } from '@/shared/ui/toast'
import { messagesOptions } from '../api/queries'
import type { MessageView } from './conversation-message.view'

const timestamp = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const tokens = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * 按参考样式展示回答操作与真实用量，鼠标移入或键盘聚焦时显示。
 * @param props 当前回复、来源会话和只读状态。
 * @returns 复制、评价、详情和会话内链接，以及模型用量和时间。
 */
export function AnswerFooter({
  message,
  conversationId,
  readOnly,
}: {
  message: MessageView
  conversationId: string
  readOnly: boolean
}) {
  const [copied, setCopied] = useState(false)
  const client = useQueryClient()
  const { showToast } = useToast()
  const feedback = useMutation({
    mutationFn: (rating: 'helpful' | 'unhelpful' | null) =>
      apiClient.rateBotMessage(conversationId, message.id, { rating }, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: () => client.invalidateQueries({ queryKey: messagesOptions(conversationId).queryKey }),
    onError: (error) => showToast(describeRequestError(error).description, 'error'),
  })
  const rating = feedback.isSuccess ? feedback.data.data.rating : message.feedback
  const metrics = message.metrics
  const elapsed = message.elapsed ?? (metrics ? `${(metrics.durationMs / 1000).toFixed(1)} 秒` : undefined)
  const totalTokens =
    metrics && metrics.inputTokens + metrics.outputTokens + metrics.cacheReadTokens + metrics.cacheWriteTokens
  async function copy(text: string, isLink = false) {
    try {
      await navigator.clipboard.writeText(text)
      if (isLink) showToast('已复制回答链接', 'success')
      else setCopied(true)
    } catch {
      showToast('复制失败，请检查浏览器剪贴板权限。', 'error')
    }
  }
  return (
    <div className="dsh-answer-footer" role="group" aria-label="回答操作">
      <div className="dsh-answer-controls">
        <Button
          unstyled
          type="button"
          className="dsh-answer-action"
          title="复制回答"
          aria-label={copied ? '已复制回答' : '复制回答'}
          onClick={() => void copy(message.text)}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        {!readOnly &&
          (['helpful', 'unhelpful'] as const).map((value) => (
            <Button
              key={value}
              unstyled
              type="button"
              className="dsh-answer-action"
              title={value === 'helpful' ? '回答有帮助' : '回答无帮助'}
              aria-label={value === 'helpful' ? '回答有帮助' : '回答无帮助'}
              aria-pressed={rating === value}
              disabled={feedback.isPending}
              onClick={() => feedback.mutate(rating === value ? null : value)}
            >
              {value === 'helpful' ? <ThumbsUp /> : <ThumbsDown />}
            </Button>
          ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button unstyled type="button" className="dsh-answer-action" title="回答详情" aria-label="回答详情">
              <AlignLeft />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-4 text-sm" side="top">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt>发言人</dt>
              <dd>{message.name}</dd>
              {elapsed && (
                <>
                  <dt>耗时</dt>
                  <dd>{elapsed}</dd>
                </>
              )}
              {metrics && (
                <>
                  <dt>输入 Token</dt>
                  <dd>{metrics.inputTokens}</dd>
                  <dt>输出 Token</dt>
                  <dd>{metrics.outputTokens}</dd>
                  <dt>缓存读取</dt>
                  <dd>{metrics.cacheReadTokens}</dd>
                  <dt>缓存写入</dt>
                  <dd>{metrics.cacheWriteTokens}</dd>
                  <dt>轮次</dt>
                  <dd>{metrics.turns}</dd>
                </>
              )}
            </dl>
          </PopoverContent>
        </Popover>
        <Button
          unstyled
          type="button"
          className="dsh-answer-action"
          title="复制回答链接"
          aria-label="复制回答链接"
          onClick={() => {
            const url = new URL(`/collaboration/${conversationId}`, window.location.origin)
            url.hash = `message-${message.id}`
            void copy(url.href, true)
          }}
        >
          <Share2 />
        </Button>
        {totalTokens !== undefined && (
          <span className="dsh-answer-usage">
            <Database aria-hidden="true" />
            用量 {tokens.format(totalTokens)} tok
          </span>
        )}
        {message.time && <time dateTime={message.time}>{timestamp.format(new Date(message.time))}</time>}
      </div>
    </div>
  )
}
