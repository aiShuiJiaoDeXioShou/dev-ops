import { useId, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
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
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { useGroupMemberChoices } from '../api/group-members'
import type { BotConversation } from '../api/queries'

function toggleSelection(state: string[], id: string, selected: boolean) {
  return selected ? [...state, id] : state.filter((item) => item !== id)
}

/** 创建团队群组，Leader 从已选且可执行的智能体中指定。 */
export function NewGroupDialog({
  teamId,
  userId,
  onClose,
  onCreated,
}: {
  teamId: string
  userId: string
  onClose: () => void
  onCreated: (room: BotConversation) => void
}) {
  const formId = useId()
  const [name, setName] = useState('')
  const [selectedBots, setSelectedBots] = useState<string[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedLeader, setSelectedLeader] = useState('')
  const choices = useGroupMemberChoices(teamId)
  const leads = choices.bots.filter((bot) => selectedBots.includes(bot.id) && bot.availability === 'available')
  const leader = leads.some(({ id }) => id === selectedLeader) ? selectedLeader : (leads[0]?.id ?? '')
  const create = useMutation({
    mutationFn: () =>
      apiClient.createBotConversation(
        teamId,
        {
          kind: 'group',
          name: name.trim(),
          leaderBotId: leader,
          botIds: selectedBots,
          memberUserIds: selectedUsers,
        },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: ({ data }) => onCreated(data),
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
          <DialogTitle>新建群组</DialogTitle>
          <DialogDescription>选择成员和默认接收消息的 Leader。</DialogDescription>
        </DialogFormHeader>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            if (leader && name.trim() && !create.isPending) create.mutate()
          }}
        >
          <DialogFormBody>
            <label className="field">
              <span>群组名称</span>
              <Input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {choices.pending && <DelayedPageSkeleton />}
            {choices.error && <PageError title="成员加载失败" error={choices.error} onRetry={choices.retry} />}
            {!choices.pending && !choices.error && (
              <>
                <fieldset className="field">
                  <legend>智能体</legend>
                  {choices.bots.length === 0 && <p className="small muted">团队还没有智能体</p>}
                  <div className="work-checks">
                    {choices.bots.map((bot) => (
                      <label className="row" key={bot.id}>
                        <Checkbox
                          checked={selectedBots.includes(bot.id)}
                          onCheckedChange={(checked) =>
                            setSelectedBots((value) => toggleSelection(value, bot.id, checked === true))
                          }
                        />
                        <span>{bot.name}</span>
                      </label>
                    ))}
                  </div>
                  {choices.more && (
                    <Button type="button" variant="ghost" disabled={choices.loadingMore} onClick={choices.loadMore}>
                      加载更多智能体
                    </Button>
                  )}
                </fieldset>
                <label className="field">
                  <span>Leader</span>
                  <Select required value={leader} onChange={(event) => setSelectedLeader(event.target.value)}>
                    <option value="">请先选择可用的智能体</option>
                    {leads.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <fieldset className="field">
                  <legend>团队成员</legend>
                  <div className="work-checks">
                    {choices.users
                      .filter(({ userId: memberId }) => userId !== memberId)
                      .map((member) => (
                        <label className="row" key={member.userId}>
                          <Checkbox
                            checked={selectedUsers.includes(member.userId)}
                            onCheckedChange={(checked) =>
                              setSelectedUsers((value) => toggleSelection(value, member.userId, checked === true))
                            }
                          />
                          <span>{member.name}</span>
                        </label>
                      ))}
                  </div>
                </fieldset>
              </>
            )}
            {create.isError && (
              <p className="field-error" role="alert">
                {describeRequestError(create.error).description}
              </p>
            )}
          </DialogFormBody>
        </form>
        <DialogFormFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={create.isPending || !name.trim() || !leader}>
            创建群组
          </Button>
        </DialogFormFooter>
      </DialogContent>
    </Dialog>
  )
}
