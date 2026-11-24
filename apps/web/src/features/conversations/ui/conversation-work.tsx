import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, MessageSquareText, Terminal, X } from 'lucide-react'
import { Button } from '@/shared/ui/controls/button'
import { conversationTraceOptions } from '../api/queries'
import { conversationWork, traceStatuses, type TraceStep } from '../model/conversation-trace'
import { ConversationMarkdown } from './conversation-markdown'
import type { MessageView } from './conversation-message.view'

function WorkStep({ step, interrupted }: { step: TraceStep; interrupted: boolean }) {
  if (step.kind === 'model' && step.text) {
    if (step.status === 'running') {
      return (
        <li className="conversation-work-draft">
          <ConversationMarkdown text={step.text} running compact />
        </li>
      )
    }

    return (
      <li>
        <details className="conversation-work-note">
          <summary className="conversation-work-row">
            <MessageSquareText aria-hidden="true" />
            <span className="conversation-work-preview">{step.text.replace(/\s+/gu, ' ').trim()}</span>
            <ChevronDown className="conversation-work-expand" aria-hidden="true" />
          </summary>
          <ConversationMarkdown text={step.text} running={false} compact />
        </details>
      </li>
    )
  }

  const status = step.status === 'running' && interrupted ? 'interrupted' : step.status
  return (
    <li className="conversation-work-row">
      <Terminal aria-hidden="true" />
      <span className="conversation-work-preview" title={step.target ?? step.title}>
        {status === 'running' && '正在运行 '}
        {step.title}
        {step.target && step.target !== step.title && <small>{step.target}</small>}
      </span>
      <span className="conversation-work-state" data-state={status}>
        {status === 'done' && <Check aria-hidden="true" />}
        {status === 'failed' && <X aria-hidden="true" />}
        <span className={status === 'done' || status === 'failed' ? 'sr-only' : undefined}>
          {traceStatuses[status]}
        </span>
      </span>
    </li>
  )
}

/**
 * 在答案上方显示此次运行的工具调用和已经公开的阶段输出。
 * @param props 消息视图、历史运行所属会话，以及群聊是否需要标出执行者。
 * @returns 进行中默认展开的工作过程，最终回答出现时自动折叠。
 */
export function ConversationWork({
  message,
  conversationId,
  showBotName,
}: {
  message: MessageView
  conversationId: string
  showBotName: boolean
}) {
  const contentId = useId()
  const [preference, setPreference] = useState<{ open: boolean; running: boolean }>()
  const running = message.status === 'running'
  const open = preference?.running === running ? preference.open : running
  const runId = message.runId
  const inlineSteps = message.workSteps ?? []
  const canReadHistory = !!runId && message.isStored === true && message.status === 'succeeded'
  const shouldReadHistory = canReadHistory && open
  const client = useQueryClient()
  const history = useQuery({
    ...conversationTraceOptions(client, conversationId, runId ?? ''),
    enabled: shouldReadHistory,
  })
  const steps =
    shouldReadHistory && history.data && runId
      ? conversationWork({ id: runId, status: message.status }, history.data.items).steps
      : inlineSteps
  const canExpand = steps.length > 0 || canReadHistory
  if (!runId || !message.status) return null
  const pending = message.status === 'queued'
  const stopped = message.status === 'stopped'
  const failed = message.status === 'failed'
  const hasFinished = !running && !pending && !stopped && !failed
  const label =
    running && message.statusText !== '正在停止…' ? '正在工作' : message.statusText || (hasFinished ? '已完成' : '')
  const elapsed =
    message.metrics?.durationMs === undefined ? message.elapsed : `${(message.metrics.durationMs / 1000).toFixed(1)} 秒`
  const heading = hasFinished && elapsed ? '已工作' : label
  const header = (
    <>
      <span role="status">{heading}</span>
      {elapsed && (running || hasFinished) && (
        <span className="dsh-running-time" aria-hidden={running || undefined}>
          {elapsed}
        </span>
      )}
      {stopped && message.text && <span>已保留部分结果</span>}
      {showBotName && <span className="conversation-work-bot">{message.name}</span>}
    </>
  )

  return (
    <section className="conversation-work" aria-label="工作过程">
      {canExpand ? (
        <Button
          type="button"
          unstyled
          className="conversation-work-header"
          aria-label={[heading, hasFinished ? elapsed : undefined, showBotName ? message.name : undefined]
            .filter(Boolean)
            .join(' ')}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setPreference({ open: !open, running })}
        >
          {header}
          <ChevronDown className="conversation-work-expand" aria-hidden="true" />
        </Button>
      ) : (
        <div className="conversation-work-header">{header}</div>
      )}
      {canExpand && (
        <div id={contentId} className="conversation-work-content" data-open={open} inert={!open} aria-hidden={!open}>
          <div>
            {steps.length > 0 && (
              <ol className="conversation-work-steps">
                {steps.map((step) => (
                  <WorkStep key={step.id} step={step} interrupted={!running} />
                ))}
              </ol>
            )}
            {shouldReadHistory && history.isPending && steps.length === 0 && <p role="status">正在读取工作过程…</p>}
            {shouldReadHistory && history.isError && (
              <Button type="button" variant="ghost" onClick={() => void history.refetch()}>
                工作过程读取失败，重试
              </Button>
            )}
            {shouldReadHistory && history.isSuccess && !history.data.hasMore && steps.length === 0 && (
              <p role="status">这次运行没有留下工作步骤</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
