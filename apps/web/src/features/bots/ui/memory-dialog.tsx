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
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { BotMemory } from '../api/memories'
import type { BotView } from '../api/queries'

/**
 * 新增记忆或修改正文与常驻标记，支持内嵌侧栏。
 * @param props 记忆、团队、Bot 候选与默认 Bot、范围权限、展示方式和保存/关闭回调。
 * @returns 共用校验与保存逻辑的内嵌表单或弹窗；失败保留内容。
 */
export function MemoryDialog({
  item,
  teamId,
  bots,
  botId,
  allowBotScope,
  inline = false,
  onClose,
  onSaved,
}: {
  item?: BotMemory
  teamId: string
  bots: Pick<BotView, 'id' | 'name'>[]
  botId?: string
  allowBotScope: boolean
  inline?: boolean
  onClose: () => void
  onSaved: () => void | Promise<unknown>
}) {
  const form = useId()
  const [selected, setSelected] = useState(botId ?? '')
  const [scope, setScope] = useState<BotMemory['scope']>('user')
  const [content, setContent] = useState(item?.content ?? '')
  const [essential, setEssential] = useState(item?.essential ?? false)
  const save = useMutation({
    mutationFn: () => {
      const options = { idempotencyKey: createIdempotencyKey() }
      return item
        ? apiClient.updateBotMemory(
            item.id,
            {
              content: item.content === content.trim() ? undefined : content.trim(),
              essential: item.essential === essential ? undefined : essential,
            },
            options,
          )
        : apiClient.createBotMemory(teamId, { botId: selected, content: content.trim(), essential, scope }, options)
    },
    onSuccess: onSaved,
  })
  const changed = item ? item.content !== content.trim() || item.essential !== essential : Boolean(selected)
  const hasEdits = item ? changed : !!content.trim() || essential || scope !== 'user'
  const canSubmit = Boolean(content.trim()) && changed && !save.isPending
  const Body = inline ? 'div' : DialogFormBody
  const Footer = inline ? 'div' : DialogFormFooter
  const formContent = (
    <>
      <form
        id={form}
        data-settings-dirty={(inline && hasEdits) || undefined}
        data-settings-pending={(inline && save.isPending) || undefined}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) save.mutate()
        }}
      >
        <Body className={inline ? 'grid gap-3' : undefined}>
          {!item && (
            <>
              {(!inline || !botId) && (
                <label className="field">
                  <span>智能体</span>
                  <Select required value={selected} onChange={(event) => setSelected(event.target.value)}>
                    <option value="">请选择智能体</option>
                    {bots.map(({ id, name }) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {allowBotScope && (
                <label className="field">
                  <span>范围</span>
                  <Select value={scope} onChange={(event) => setScope(event.target.value === 'bot' ? 'bot' : 'user')}>
                    <option value="user">用户画像</option>
                    <option value="bot">Bot 笔记</option>
                  </Select>
                </label>
              )}
            </>
          )}
          <label className="field">
            <span>正文</span>
            <Textarea
              autoFocus
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={2000}
              required
            />
          </label>
          <label className="row">
            <Checkbox checked={essential} onCheckedChange={(checked) => setEssential(checked === true)} /> 常驻记忆
          </label>
          {save.isError && (
            <p className="field-error" role="alert">
              {describeRequestError(save.error).description}
            </p>
          )}
        </Body>
      </form>
      <Footer className={inline ? 'row justify-end' : undefined}>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" form={form} disabled={!canSubmit}>
          保存
        </Button>
      </Footer>
    </>
  )
  if (inline) return <div className="grid gap-3">{formContent}</div>
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent className="dialog-w-md">
        <DialogFormHeader>
          <DialogTitle>{item ? '编辑记忆' : '新增记忆'}</DialogTitle>
          <DialogDescription>{item ? item.botName : '保存长期偏好与团队约定。'}</DialogDescription>
        </DialogFormHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  )
}
