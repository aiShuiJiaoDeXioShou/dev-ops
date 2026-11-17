import { useId, useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
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
import { useToast } from '@/shared/ui/toast'
import { botQueryKey, type BotView } from '../api/queries'

interface BotFormProps {
  teamId: string
  bot?: BotView
  defaultOwnerId: string
  onClose: () => void
}

/** 创建或编辑 Bot。调用方仅在弹窗打开时挂载，关闭后重新初始化草稿。 */
export function BotForm({ teamId, bot, defaultOwnerId, onClose }: BotFormProps) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const defaultOwner = bot?.ownerUserId ?? defaultOwnerId
  const [discardOpen, setDiscardOpen] = useState(false)
  const [name, setName] = useState(bot?.name ?? '')
  const [responsibility, setResponsibility] = useState(bot?.responsibility ?? '')
  const [instructions, setInstructions] = useState(bot?.instructions ?? '')
  const [ownerUserId, setOwnerUserId] = useState(defaultOwner)
  const owners = members.data?.data.filter((member) => member.status === 'active') ?? []
  const selectedOwnerActive = owners.some((member) => member.userId === ownerUserId)
  const mutation = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), responsibility: responsibility.trim(), instructions, ownerUserId }
      const options = { idempotencyKey: createIdempotencyKey() }
      return bot
        ? apiClient.updateBot(bot.id, { ...input, configVersion: bot.configVersion }, options)
        : apiClient.createBot(teamId, input, options)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: botQueryKey })
      showToast(bot ? 'Bot 已保存' : 'Bot 已创建', 'success')
      onClose()
    },
  })
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutation.isPending && selectedOwnerActive) mutation.mutate()
  }
  function close() {
    if (mutation.isPending) return
    const hasEdits =
      name !== (bot?.name ?? '') ||
      responsibility !== (bot?.responsibility ?? '') ||
      instructions !== (bot?.instructions ?? '') ||
      ownerUserId !== defaultOwner
    if (hasEdits) setDiscardOpen(true)
    else onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent layout="form">
        <DialogFormHeader>
          <DialogTitle>{bot ? '编辑 Bot' : '创建 Bot'}</DialogTitle>
          <DialogDescription>设置 Bot 的职责、负责人和运行指令。</DialogDescription>
        </DialogFormHeader>
        <form className="flex min-h-0 flex-col" onSubmit={save}>
          <DialogFormBody className="space-y-4">
            <label className="field" htmlFor={`${id}-name`}>
              <span>名称</span>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                required
              />
            </label>
            <label className="field" htmlFor={`${id}-owner`}>
              <span>负责人</span>
              <Select
                id={`${id}-owner`}
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
                disabled={members.isPending || members.isError}
                required
              >
                {!selectedOwnerActive && (
                  <option value={ownerUserId}>{members.isPending ? '正在加载成员…' : '请选择有效成员'}</option>
                )}
                {owners.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </label>
            {members.isError && (
              <Button type="button" variant="outline" onClick={() => void members.refetch()}>
                重试加载成员
              </Button>
            )}
            <label className="field" htmlFor={`${id}-responsibility`}>
              <span>职责</span>
              <Textarea
                id={`${id}-responsibility`}
                value={responsibility}
                onChange={(event) => setResponsibility(event.target.value)}
                maxLength={4000}
                rows={3}
                required
              />
            </label>
            <label className="field" htmlFor={`${id}-instructions`}>
              <span>指令（选填）</span>
              <Textarea
                id={`${id}-instructions`}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                maxLength={16000}
                rows={5}
              />
            </label>
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {describeRequestError(mutation.error).description}
              </p>
            )}
          </DialogFormBody>
          <DialogFormFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !selectedOwnerActive || !name.trim() || !responsibility.trim()}
            >
              {mutation.isPending ? '正在保存…' : bot ? '保存' : '创建'}
            </Button>
          </DialogFormFooter>
        </form>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>放弃编辑？</AlertDialogTitle>
              <AlertDialogDescription>关闭会清除这次尚未保存的 Bot 配置。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>继续编辑</AlertDialogCancel>
              <AlertDialogAction onClick={onClose}>放弃修改</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
