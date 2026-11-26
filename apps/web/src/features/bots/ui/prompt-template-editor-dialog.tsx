import { useId, useRef, useState, type FormEvent } from 'react'
import { createIdempotencyKey, type ApiSuccessData } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
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
  AlertDialogTrigger,
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
import { Textarea } from '@/shared/ui/controls/textarea'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import {
  PROMPT_ARGUMENTS_TOKEN,
  hasPromptArguments,
  isValidPromptTemplateName,
  splitPromptArguments,
} from '../model/prompt-template-utils'

/** 提示模板列表条目类型。 */
export type BotPromptTemplateItem = ApiSuccessData<
  '/api/v1/teams/{teamId}/bot-prompt-templates',
  'get'
>['items'][number]

/** 提示模板新建或派生时的初始草稿。 */
export interface PromptTemplateDraft {
  name: string
  description: string
  body: string
}

/**
 * 渲染带 `$ARGUMENTS` 高亮芯片的提示词正文。
 * @param props.body 模板正文文本。
 * @param props.emptyText 正文为空时的占位提示。
 */
export function PromptHighlightedBody({ body, emptyText = '' }: { body: string; emptyText?: string }) {
  if (!body) return <span className="text-muted-foreground">{emptyText}</span>
  return (
    <>
      {splitPromptArguments(body).map((segment, index) =>
        segment.isArgument ? (
          <span key={index} className="prompt-var-chip">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  )
}

/**
 * 提示模板双栏编辑/新建/查看弹窗：左侧维护命令与正文，右侧实时预览 `/` 菜单与变量高亮；删除走标准 AlertDialog 二次确认。
 * @param props.teamId 团队标识。
 * @param props.open 弹窗是否打开。
 * @param props.template 待编辑模板；为空表示新建或派生。
 * @param props.initialDraft 派生模板时预填的草稿。
 * @param props.write 是否具备写权限。
 * @param props.onOpenChange 开关回调。
 * @param props.onSaved 保存成功回调。
 * @param props.onRemoved 删除成功回调。
 * @param props.onRestoreFocus 关闭后焦点归还回调。
 */
export function PromptTemplateEditorDialog({
  teamId,
  open,
  template,
  initialDraft,
  write,
  onOpenChange,
  onSaved,
  onRemoved,
  onRestoreFocus,
}: {
  teamId: string
  open: boolean
  template?: BotPromptTemplateItem
  initialDraft?: PromptTemplateDraft | null
  write: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (saved: BotPromptTemplateItem) => void
  onRemoved?: (templateId: string) => void
  onRestoreFocus?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <PromptTemplateEditorContent
          key={template?.id ?? initialDraft?.name ?? 'new'}
          teamId={teamId}
          template={template}
          initialDraft={initialDraft}
          write={write}
          close={() => onOpenChange(false)}
          onSaved={onSaved}
          onRemoved={onRemoved}
          onRestoreFocus={onRestoreFocus}
        />
      )}
    </Dialog>
  )
}

function PromptTemplateEditorContent({
  teamId,
  template,
  initialDraft,
  write,
  close,
  onSaved,
  onRemoved,
  onRestoreFocus,
}: {
  teamId: string
  template?: BotPromptTemplateItem
  initialDraft?: PromptTemplateDraft | null
  write: boolean
  close: () => void
  onSaved?: (saved: BotPromptTemplateItem) => void
  onRemoved?: (templateId: string) => void
  onRestoreFocus?: () => void
}) {
  const [name, setName] = useState(template?.name ?? initialDraft?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? initialDraft?.description ?? '')
  const [body, setBody] = useState(template?.body ?? initialDraft?.body ?? '')
  const bodyId = useId()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const client = useQueryClient()
  const { showToast } = useToast()

  const saveMutation = useMutation({
    mutationFn: () => {
      const options = { idempotencyKey: createIdempotencyKey() }
      const input = { name: name.trim(), description: description.trim(), body: body.trim() }
      return template
        ? apiClient.updateBotPromptTemplate(template.id, input, options)
        : apiClient.createBotPromptTemplate(teamId, input, options)
    },
    onSuccess: async (response) => {
      await client.invalidateQueries({ queryKey: ['bot-prompt-templates', teamId] })
      showToast(template ? `已保存模板 /${response.data.name}` : `已新建模板 /${response.data.name}`, 'success')
      onSaved?.(response.data)
      close()
    },
  })

  const removeMutation = useMutation({
    mutationFn: () => {
      if (!template) throw new Error('模板不存在')
      return apiClient.removeBotPromptTemplate(template.id, { idempotencyKey: createIdempotencyKey() })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['bot-prompt-templates', teamId] })
      showToast(`已删除模板 /${template?.name ?? ''}`, 'success')
      if (template) onRemoved?.(template.id)
      close()
    },
  })

  const pending = saveMutation.isPending || removeMutation.isPending
  const locked = !write || pending
  const trimmedName = name.trim()
  const validName = isValidPromptTemplateName(trimmedName)
  const valid = validName && Boolean(description.trim()) && Boolean(body.trim())
  const containsArgs = hasPromptArguments(body)
  const activeError = saveMutation.error ?? removeMutation.error

  const insertArgumentsToken = () => {
    const textarea = bodyRef.current
    if (!textarea || locked) return
    const start = textarea.selectionStart ?? body.length
    const end = textarea.selectionEnd ?? body.length
    const next = `${body.slice(0, start)}${PROMPT_ARGUMENTS_TOKEN}${body.slice(end)}`
    setBody(next)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + PROMPT_ARGUMENTS_TOKEN.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!locked && valid) saveMutation.mutate()
  }

  return (
    <DialogContent
      layout="form"
      className="prompt-editor-dialog"
      showCloseButton={!pending}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault()
      }}
      onPointerDownOutside={(event) => {
        if (pending) event.preventDefault()
      }}
      onCloseAutoFocus={(event) => {
        if (!onRestoreFocus) return
        event.preventDefault()
        onRestoreFocus()
      }}
    >
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <DialogFormHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>
              {template
                ? write
                  ? '编辑提示模板'
                  : `/${template.name}`
                : initialDraft
                  ? '派生提示模板'
                  : '新建提示模板'}
            </DialogTitle>
            <Tag variant={containsArgs ? 'green' : 'neutral'}>{containsArgs ? '已识别 $ARGUMENTS' : '纯指令模板'}</Tag>
          </div>
          <DialogDescription>在会话输入框键入 / 即可选择模板；使用 $ARGUMENTS 引用成员填写的内容。</DialogDescription>
        </DialogFormHeader>

        <DialogFormBody>
          <div className="prompt-editor-split">
            <div className="space-y-4">
              <label className="field" htmlFor={bodyId}>
                <span className="flex items-center justify-between gap-2">
                  <span>命令名称</span>
                  <span className="text-xs font-normal text-muted-foreground">小写字母、数字、短横线</span>
                </span>
                <div className="prompt-prefix-field">
                  <span className="prompt-prefix-symbol font-mono" aria-hidden="true">
                    /
                  </span>
                  <Input
                    required
                    maxLength={40}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    readOnly={locked}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="review-plan"
                  />
                </div>
                {write && name.length > 0 && !validName && (
                  <span className="text-xs text-destructive" role="alert">
                    命令名称只能包含小写字母、数字，并以单个短横线分隔。
                  </span>
                )}
              </label>

              <label className="field" htmlFor={bodyId}>
                <span className="flex items-center justify-between gap-2">
                  <span>摘要</span>
                  <span className="text-xs font-normal text-muted-foreground">{description.length} / 200</span>
                </span>
                <Input
                  required
                  maxLength={200}
                  readOnly={locked}
                  value={description}
                  placeholder="一句话说明此模板的用途与产出"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="field" htmlFor={bodyId}>
                <span className="flex items-center justify-between gap-2">
                  <span>模板正文</span>
                  {write && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={locked}
                      onClick={insertArgumentsToken}
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      插入 $ARGUMENTS
                    </Button>
                  )}
                </span>
                <Textarea
                  id={bodyId}
                  ref={bodyRef}
                  required
                  rows={9}
                  maxLength={16000}
                  readOnly={locked}
                  className="font-mono text-xs"
                  value={body}
                  placeholder="编写发给 Bot 的结构化指令，可在需要注入成员输入的位置插入 $ARGUMENTS。"
                  onChange={(event) => setBody(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  {body.length} / 16000 字 · 使用 $ARGUMENTS 引用成员填写的内容。
                </span>
              </label>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="prompt-section-label">会话中键入 / 菜单预览</p>
                <div className="prompt-slash-preview" aria-label="会话命令菜单预览">
                  <div className="prompt-slash-preview-active">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="truncate font-mono text-sm font-semibold text-primary">
                        /{trimmedName || 'command-name'}
                      </div>
                      <p className="m-0 line-clamp-2 text-xs text-muted-foreground">
                        {description.trim() || '填写摘要后会在这里提示成员该命令的用途'}
                      </p>
                    </div>
                    {containsArgs && <Tag variant="blue">带参数</Tag>}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="prompt-section-label">变量高亮预览</p>
                <div className="prompt-detail-box text-xs">
                  <PromptHighlightedBody body={body} emptyText="编写正文后将在此实时高亮 $ARGUMENTS 变量位置…" />
                </div>
              </div>
            </div>
          </div>

          {activeError && (
            <p role="alert" className="field-error mt-4">
              {describeRequestError(activeError).description}
            </p>
          )}
        </DialogFormBody>

        <DialogFormFooter className="justify-between">
          <div>
            {template && write && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive" disabled={locked}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    删除模板
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除提示模板 /{template.name}？</AlertDialogTitle>
                    <AlertDialogDescription>
                      删除后无法恢复，此命令会立即从团队会话的 / 模板列表中移除。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => removeMutation.mutate()}>
                      {removeMutation.isPending ? '删除中…' : '确认删除'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {write ? '取消' : '关闭'}
            </Button>
            {write && (
              <Button type="submit" disabled={locked || !valid} aria-busy={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中…' : '保存模板'}
              </Button>
            )}
          </div>
        </DialogFormFooter>
      </form>
    </DialogContent>
  )
}
