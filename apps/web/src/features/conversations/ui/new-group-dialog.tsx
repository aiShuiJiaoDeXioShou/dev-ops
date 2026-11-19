import { useId, useState, type ReactNode } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation } from '@tanstack/react-query'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { BotStatus } from '@/features/bots/ui/bot-status'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { cn } from '@/shared/lib/utils'
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
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { useGroupMemberChoices } from '../api/group-members'
import type { BotConversation } from '../api/queries'
import './new-group-dialog.css'

function toggleSelection(state: string[], id: string, selected: boolean) {
  return selected ? [...state, id] : state.filter((item) => item !== id)
}

function GroupMemberOption({
  name,
  avatar,
  description,
  status,
  checked,
  disabled,
  onSelect,
}: {
  name: string
  avatar: ReactNode
  description?: string
  status?: ReactNode
  checked: boolean
  disabled: boolean
  onSelect: (selected: boolean) => void
}) {
  const nameId = useId()
  const descriptionId = `${nameId}-description`
  const statusId = `${nameId}-status`
  return (
    <label
      className={cn(
        'form-inline-label min-h-14 min-w-0 cursor-pointer rounded-lg px-3 py-2 hover:bg-muted/70',
        checked && 'bg-muted',
        disabled && 'cursor-default',
      )}
    >
      <span className="shrink-0">{avatar}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2.5">
        <span id={nameId} className="min-w-0 text-sm leading-5 font-medium wrap-anywhere">
          {name}
        </span>
        {description && (
          <span id={descriptionId} className="min-w-0 text-xs leading-5 wrap-anywhere text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {status && (
        <span id={statusId} className="shrink-0 sm:w-20">
          {status}
        </span>
      )}
      <Checkbox
        aria-labelledby={nameId}
        aria-describedby={[description && descriptionId, status && statusId].filter(Boolean).join(' ') || undefined}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onSelect(value === true)}
      />
    </label>
  )
}

const memberList = 'min-w-0 divide-y divide-border rounded-xl border border-border'
const memberLegend = 'mb-2 text-sm font-medium text-foreground'

/**
 * 创建团队群组，Leader 从已选且可执行的智能体中指定。
 * @param props 当前团队与用户标识，以及关闭和创建完成回调。
 * @returns 含智能体、Leader 和可选团队成员的表单，提交失败时保留选择。
 */
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
  const nameId = useId()
  const leaderId = useId()
  const [name, setName] = useState('')
  const [selectedBots, setSelectedBots] = useState<string[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedLeader, setSelectedLeader] = useState('')
  const choices = useGroupMemberChoices(teamId)
  const otherMembers = choices.users.filter((member) => member.userId !== userId)
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
  const canCreate = Boolean(name.trim() && leader && !choices.pending && !choices.error && !create.isPending)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose()
      }}
    >
      <DialogContent layout="form" className="dialog-w-md new-group-dialog" showCloseButton={!create.isPending}>
        <DialogFormHeader>
          <DialogTitle>新建群组</DialogTitle>
          <DialogDescription>Leader 默认接收未点名的消息。</DialogDescription>
        </DialogFormHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (canCreate) create.mutate()
          }}
        >
          <DialogFormBody className="space-y-5 sm:py-5">
            <FormField label="群组名称" htmlFor={nameId}>
              <Input
                id={nameId}
                autoFocus
                required
                maxLength={80}
                value={name}
                disabled={create.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            {choices.pending && <DelayedPageSkeleton />}
            {choices.error && <PageError title="成员加载失败" error={choices.error} onRetry={choices.retry} />}
            {!choices.pending && !choices.error && (
              <>
                <fieldset className="min-w-0">
                  <legend className={memberLegend}>智能体</legend>
                  {choices.bots.length === 0 ? (
                    <p className="text-xs text-muted-foreground">在能力页创建智能体后，即可添加到群组。</p>
                  ) : (
                    <ul role="list" className={memberList}>
                      {choices.bots.map((bot) => (
                        <li key={bot.id} className="p-1">
                          <GroupMemberOption
                            name={bot.name}
                            description={bot.responsibility}
                            avatar={
                              <BotAvatar botId={bot.id} avatarKey={bot.avatarKey} enabled={bot.status === 'enabled'} />
                            }
                            status={
                              bot.id === leader ? (
                                <span className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">Leader</span>
                              ) : (
                                <BotStatus value={bot.availability} />
                              )
                            }
                            checked={selectedBots.includes(bot.id)}
                            disabled={create.isPending}
                            onSelect={(checked) => setSelectedBots((value) => toggleSelection(value, bot.id, checked))}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {choices.more && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-2 min-h-11"
                      disabled={choices.loadingMore || create.isPending}
                      onClick={choices.loadMore}
                    >
                      {choices.loadingMore ? '正在加载…' : '加载更多智能体'}
                    </Button>
                  )}
                </fieldset>
                <FormField label="Leader" htmlFor={leaderId}>
                  <Select
                    id={leaderId}
                    className="flex"
                    required
                    disabled={leads.length === 0 || create.isPending}
                    value={leader}
                    onChange={(event) => setSelectedLeader(event.target.value)}
                  >
                    <option value="">请先选择可用的智能体</option>
                    {leads.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <fieldset className="min-w-0">
                  <legend className={memberLegend}>
                    团队成员 <span className="ml-1.5 text-xs font-normal text-muted-foreground">选填</span>
                  </legend>
                  {otherMembers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无其他团队成员可添加。</p>
                  ) : (
                    <ul role="list" className={memberList}>
                      {otherMembers.map((member) => (
                        <li key={member.userId} className="p-1">
                          <GroupMemberOption
                            name={member.name}
                            avatar={
                              <UserAvatar
                                name={member.name}
                                image={member.image}
                                toneSeed={member.userId}
                                className="size-10 text-sm"
                              />
                            }
                            checked={selectedUsers.includes(member.userId)}
                            disabled={create.isPending}
                            onSelect={(checked) =>
                              setSelectedUsers((value) => toggleSelection(value, member.userId, checked))
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>
              </>
            )}
            {create.isError && (
              <p className="field-error" role="alert">
                {describeRequestError(create.error).description}
              </p>
            )}
          </DialogFormBody>
          <DialogFormFooter className="py-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 px-4"
              onClick={onClose}
              disabled={create.isPending}
            >
              取消
            </Button>
            <Button type="submit" className="min-h-11 px-4" disabled={!canCreate}>
              {create.isPending ? '创建中…' : '创建群组'}
            </Button>
          </DialogFormFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
