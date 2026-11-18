import type { FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { useToast } from '@/shared/ui/toast'
import { botQueryKey, type BotView } from '../api/queries'
import { useBotModelSelection } from '../model/use-bot-model-selection'
import { BotModelFields } from './bot-model-fields'

/**
 * 允许团队管理员用目录中的可用模型更新智能体绑定。
 * @param props 待更新的智能体、是否内嵌侧栏与关闭回调。
 * @returns 模型绑定表单或弹窗，保存失败时保留当前选择。
 */
export function BotModelForm({
  bot,
  inline = false,
  onClose,
}: {
  bot: BotView
  inline?: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const selection = useBotModelSelection(bot.teamId, true, bot.modelConnectionId ?? '', bot.modelId ?? '')
  const mutation = useMutation({
    mutationFn: (binding: { connectionId: string; modelId: string }) =>
      apiClient.bindBotModel(
        bot.id,
        { ...binding, configVersion: bot.configVersion },
        {
          idempotencyKey: createIdempotencyKey(),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: botQueryKey })
      showToast('模型已绑定', 'success')
      onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selection.binding && !mutation.isPending) mutation.mutate(selection.binding)
  }

  const hasEdits = selection.connectionId !== (bot.modelConnectionId ?? '') || selection.modelId !== (bot.modelId ?? '')
  const Body = inline ? 'div' : DialogFormBody
  const Footer = inline ? 'div' : DialogFormFooter
  const form = (
    <form
      data-settings-dirty={(inline && hasEdits) || undefined}
      data-settings-pending={(inline && mutation.isPending) || undefined}
      className={inline ? 'grid gap-4' : 'flex min-h-0 flex-col'}
      onSubmit={submit}
    >
      <Body className={inline ? 'grid gap-3' : 'space-y-4'}>
        <BotModelFields selection={selection} isSaving={mutation.isPending} />
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {describeRequestError(mutation.error).description}
          </p>
        )}
      </Body>
      <Footer className={inline ? 'row justify-end' : undefined}>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={mutation.isPending || !selection.binding}>
          {mutation.isPending ? '正在保存…' : '保存配置'}
        </Button>
      </Footer>
    </form>
  )
  if (inline) return form
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="dialog-w-md">
        <DialogFormHeader>
          <DialogTitle>绑定模型</DialogTitle>
          <DialogDescription>从团队现有连接和提供方模型目录中选择。</DialogDescription>
        </DialogFormHeader>
        {form}
      </DialogContent>
    </Dialog>
  )
}
