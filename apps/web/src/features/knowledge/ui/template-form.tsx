import { useEffect, useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import type { ApiBody } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { knowledgeMutations } from '../api/mutations'
import type { TemplateDetail } from '../model/types'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'

type CreateBody = ApiBody<'/api/v1/teams/{teamId}/agent-templates', 'post'>
type UpdateBody = ApiBody<'/api/v1/agent-templates/{templateId}/update', 'post'>

/** 新建、编辑或创建副本的 AGENTS.md 模板表单。 */
export function TemplateForm({
  teamId,
  open,
  onOpenChange,
  template,
  duplicate = false,
}: {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: TemplateDetail | null
  duplicate?: boolean
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [tag, setTag] = useState('团队')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(template ? `${template.name}${duplicate ? ' 副本' : ''}` : '')
    setTag(template?.tag ?? '团队')
    setDescription(template?.description ?? '')
    setContent(template?.content ?? '# AGENTS.md\n\n## 协作约定\n')
    setError('')
  }, [open, template, duplicate])

  const editing = Boolean(template) && !duplicate
  const mutation = useMutation({
    mutationFn: async () => {
      if (editing && template) {
        const body = {
          version: template.version,
          name: name.trim(),
          tag: tag.trim(),
          description: description.trim() || null,
          content,
        } as UpdateBody
        return knowledgeMutations.updateTemplate(template.id, body)
      }
      if (template && duplicate) {
        return knowledgeMutations.duplicateTemplate(template.id, { name: name.trim() })
      }
      return knowledgeMutations.createTemplate(
        teamId,
        { name: name.trim(), tag: tag.trim(), description: description.trim() || null, content } as CreateBody,
        { idempotencyKey: createIdempotencyKey() },
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'templates'] })
      showToast(editing ? '模板已保存' : duplicate ? '已创建副本' : '模板已新建', 'success')
      onOpenChange(false)
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      setError(message)
      showToast(message, 'error')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) return setError('请填写模板名称。')
    if (!tag.trim()) return setError('请填写分类。')
    if (!editing && !content.trim()) return setError('请填写 AGENTS.md 正文。')
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="knowledge-dialog w-full max-w-3xl">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? '编辑 AGENTS.md 模板' : duplicate ? '创建模板副本' : '新建 AGENTS.md 模板'}
            </DialogTitle>
          </DialogHeader>
          <div className="form-grid">
            <label className="field">
              名称
              <Input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} autoFocus />
            </label>
            <label className="field">
              分类
              <Input value={tag} maxLength={30} onChange={(event) => setTag(event.target.value)} />
            </label>
          </div>
          <label className="field full">
            说明
            <Input value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {!duplicate && (
            <label className="field full">
              AGENTS.md 正文
              <Textarea
                value={content}
                maxLength={20000}
                rows={14}
                className="font-mono text-xs"
                spellCheck={false}
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            模板只保存在平台内，不会写入项目关联仓库；请勿写入密钥或访问凭据。
          </p>
          {editing && <p className="text-xs text-muted-foreground">保存后版本递增，选用该模板的项目将使用新版本。</p>}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '提交中…' : '保存模板'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
