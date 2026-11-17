import { useId, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { BotTaskDetail } from '../api/queries'

type Review = 'accept' | 'return'
type Result = BotTaskDetail['results'][number]

function ReviewTaskDialog({
  taskId,
  result,
  action,
  onClose,
  onReviewed,
}: {
  taskId: string
  result: Result
  action: Review
  onClose: () => void
  onReviewed: () => void
}) {
  const formId = useId()
  const [comment, setComment] = useState('')
  const accepting = action === 'accept'
  const label = accepting ? '验收通过' : '退回结果'
  const mutation = useMutation({
    mutationFn: () => {
      const options = { idempotencyKey: createIdempotencyKey() }
      const body = { resultId: result.id, comment: comment.trim() }
      return accepting
        ? apiClient.acceptBotTask(taskId, body, options)
        : apiClient.requestBotTaskChanges(taskId, body, options)
    },
    onSuccess: onReviewed,
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="dialog-w-sm">
        <DialogFormHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {accepting ? '验收后，这项任务标为已完成。' : '退回后，执行者将按补充要求继续处理。'}
          </DialogDescription>
        </DialogFormHeader>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            if (!mutation.isPending) mutation.mutate()
          }}
        >
          <DialogFormBody>
            <label className="field">
              <span>{accepting ? '验收意见（可选）' : '退回原因'}</span>
              <Textarea
                autoFocus
                required={!accepting}
                value={comment}
                maxLength={4000}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            {mutation.isError && (
              <p className="field-error" role="alert">
                {describeRequestError(mutation.error).description}
              </p>
            )}
          </DialogFormBody>
        </form>
        <DialogFormFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending || (!accepting && !comment.trim())}>
            {label}
          </Button>
        </DialogFormFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 展示任务结果及不可变评审历史，允许有写权限的成员处理最新结果。 */
export function TaskResults({
  task,
  readOnly,
  onReviewed,
}: {
  task: BotTaskDetail
  readOnly: boolean
  onReviewed: () => void
}) {
  const [action, setAction] = useState<Review>()
  const result = task.results[0]
  const reviewButton = useRef<HTMLElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  if (!result) return null
  return (
    <section>
      <h3 className="task-section-title" tabIndex={-1} ref={resultHeading}>
        任务结果
      </h3>
      {task.results.map((entry, index) => {
        const review = task.reviews.find((item) => item.resultId === entry.id)
        return (
          <details key={entry.id} className="tool-result-card" open={index === 0}>
            <summary>
              {review ? (review.decision === 'accepted' ? '已验收' : '已退回') : '待验收'} ·{' '}
              {formatDateTime(entry.createdAt)}
            </summary>
            <div className="dsh-plain-text wrap-break-word">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{entry.body}</ReactMarkdown>
            </div>
            <p className="small muted wrap-break-word">{entry.completionNote}</p>
            {entry.evidence.length > 0 && (
              <ul>
                {entry.evidence.map((item) => (
                  <li className="wrap-break-word" key={item}>
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{item}</ReactMarkdown>
                  </li>
                ))}
              </ul>
            )}
            {review?.comment && <p className="small wrap-break-word">{review.comment}</p>}
          </details>
        )
      })}
      {!readOnly && task.status === 'awaiting_review' && (
        <div className="task-actions">
          <Button
            type="button"
            onClick={(event) => {
              reviewButton.current = event.currentTarget
              setAction('accept')
            }}
          >
            验收通过
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={(event) => {
              reviewButton.current = event.currentTarget
              setAction('return')
            }}
          >
            退回结果
          </Button>
        </div>
      )}
      {action && (
        <ReviewTaskDialog
          taskId={task.id}
          result={result}
          action={action}
          onClose={() => {
            setAction(undefined)
            requestAnimationFrame(() => reviewButton.current?.focus())
          }}
          onReviewed={() => {
            setAction(undefined)
            onReviewed()
            requestAnimationFrame(() => resultHeading.current?.focus())
          }}
        />
      )}
    </section>
  )
}
