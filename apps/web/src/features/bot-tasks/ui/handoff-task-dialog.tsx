import { useId, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation } from '@tanstack/react-query'
import type { BotConversation } from '@/features/conversations/api/queries'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
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
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { BotTaskDetail } from '../api/queries'

/** 转交当前任务，要求提交原因和交接摘要。 */
export function HandoffTaskDialog({
  task,
  members,
  onClose,
  onChanged,
}: {
  task: BotTaskDetail
  members: BotConversation['members']
  onClose: () => void
  onChanged: () => void
}) {
  const id = useId()
  const [recipient, setRecipient] = useState('')
  const [reason, setReason] = useState('')
  const [summary, setSummary] = useState('')
  const [unfinished, setUnfinished] = useState('')
  const submit = useMutation({
    mutationFn: () =>
      apiClient.handoffBotTask(
        task.id,
        {
          version: task.version,
          toBotId: recipient,
          reason: reason.trim(),
          summary: summary.trim(),
          unfinished: unfinished.trim(),
        },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: onChanged,
  })
  const canSubmit = Boolean(recipient && reason.trim() && summary.trim() && !submit.isPending)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submit.isPending) onClose()
      }}
    >
      <DialogContent className="dialog-w-md">
        <DialogFormHeader>
          <DialogTitle>转交任务</DialogTitle>
          <DialogDescription>{task.title}</DialogDescription>
        </DialogFormHeader>
        <form
          id={id}
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) submit.mutate()
          }}
        >
          <DialogFormBody>
            <label className="field">
              <span>新的执行者</span>
              <Select value={recipient} required onChange={(event) => setRecipient(event.target.value)}>
                <option value="">请选择智能体</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>转交原因</span>
              <Textarea required value={reason} maxLength={4000} onChange={(event) => setReason(event.target.value)} />
            </label>
            <label className="field">
              <span>交接摘要</span>
              <Textarea
                required
                value={summary}
                maxLength={8000}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
            <label className="field">
              <span>未完成事项</span>
              <Textarea value={unfinished} maxLength={8000} onChange={(event) => setUnfinished(event.target.value)} />
            </label>
            {submit.isError && (
              <p role="alert" className="field-error">
                {describeRequestError(submit.error).description}
              </p>
            )}
          </DialogFormBody>
        </form>
        <DialogFormFooter>
          <Button type="button" variant="outline" disabled={submit.isPending} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={id} disabled={!canSubmit}>
            确认转交
          </Button>
        </DialogFormFooter>
      </DialogContent>
    </Dialog>
  )
}
