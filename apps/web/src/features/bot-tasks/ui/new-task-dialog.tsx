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
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'

/** 按协作原型显式创建任务；会话 Bot 或 Leader 预填为执行者。 */
export function NewTaskDialog({
  room,
  userId,
  onClose,
  onCreated,
}: {
  room: BotConversation
  userId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const id = useId()
  const humans = room.members.filter(({ kind }) => kind === 'user')
  const bots = room.members.filter(({ kind }) => kind === 'bot')
  const [title, setTitle] = useState('')
  const [criteria, setCriteria] = useState('')
  const [owner, setOwner] = useState(userId)
  const [executor, setExecutor] = useState(room.leaderBotId ?? bots[0]?.id ?? '')
  const create = useMutation({
    mutationFn: () =>
      apiClient.createBotTask(
        room.id,
        {
          title: title.trim(),
          acceptanceCriteria: criteria.trim(),
          businessOwnerId: owner,
          executorBotId: executor,
        },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: ({ data }) => onCreated(data.task.id),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose()
      }}
    >
      <DialogContent className="dialog-w-md">
        <DialogFormHeader>
          <DialogTitle>新建协作任务</DialogTitle>
          <DialogDescription>{room.name}</DialogDescription>
        </DialogFormHeader>
        <form
          id={id}
          onSubmit={(event) => {
            event.preventDefault()
            if (!create.isPending) create.mutate()
          }}
        >
          <DialogFormBody>
            <div className="form-grid">
              <label className="field full">
                <span>任务目标</span>
                <Input
                  autoFocus
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="field">
                <span>业务负责人</span>
                <Select required value={owner} onChange={(event) => setOwner(event.target.value)}>
                  {humans.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>执行者</span>
                <Select required value={executor} onChange={(event) => setExecutor(event.target.value)}>
                  {bots.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field full">
                <span>验收条件</span>
                <Textarea
                  required
                  maxLength={8000}
                  value={criteria}
                  onChange={(event) => setCriteria(event.target.value)}
                />
              </label>
            </div>
            {create.isError && (
              <p role="alert" className="field-error">
                {describeRequestError(create.error).description}
              </p>
            )}
          </DialogFormBody>
        </form>
        <DialogFormFooter>
          <Button variant="outline" type="button" disabled={create.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            form={id}
            disabled={create.isPending || !title.trim() || !criteria.trim() || !executor || !owner}
          >
            {create.isPending ? '正在创建…' : '创建任务'}
          </Button>
        </DialogFormFooter>
      </DialogContent>
    </Dialog>
  )
}
