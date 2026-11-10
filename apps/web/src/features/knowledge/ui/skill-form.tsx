import { useEffect, useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import type { ApiBody } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { knowledgeMutations } from '../api/mutations'
import { SKILL_CATEGORY_OPTIONS } from '../model/labels'
import type { SkillDetail, SkillListItem } from '../model/types'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'

type CreateBody = ApiBody<'/api/v1/teams/{teamId}/skills', 'post'>
type UpdateBody = ApiBody<'/api/v1/skills/{skillId}/update', 'post'>

/** 技能发布与编辑表单。 */
export function SkillForm({
  teamId,
  open,
  onOpenChange,
  skill,
}: {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  skill?: SkillDetail | null
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [category, setCategory] = useState<SkillListItem['category']>('engineering')
  const [contentVersion, setContentVersion] = useState('1.0.0')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(skill?.name ?? '')
    setIdentifier(skill?.identifier ?? '')
    setCategory(skill?.category ?? 'engineering')
    setContentVersion(skill?.contentVersion ?? '1.0.0')
    setSummary(skill?.summary ?? '')
    setContent(skill?.content ?? '')
    setError('')
  }, [open, skill])

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        category,
        contentVersion: contentVersion.trim(),
        summary: summary.trim(),
        content: content.trim(),
      }
      if (skill) return knowledgeMutations.updateSkill(skill.id, { ...body, version: skill.version } as UpdateBody)
      return knowledgeMutations.createSkill(teamId, { ...body, identifier: identifier.trim() } as CreateBody, {
        idempotencyKey: createIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'skills'] })
      showToast(skill ? '技能已保存' : '技能已发布', 'success')
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
    if (!name.trim()) return setError('请填写技能名称。')
    if (!skill && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(identifier.trim())) {
      return setError('调用标识只允许小写字母、数字和连字符。')
    }
    if (!/^\d+\.\d+\.\d+$/.test(contentVersion.trim())) return setError('版本号需要形如 1.0.0。')
    if (!summary.trim()) return setError('请填写一句话简述。')
    if (!content.trim()) return setError('请填写 SKILL.md 指令。')
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{skill ? '编辑 Skill' : '发布团队 Skill'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              名称
              <Input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} autoFocus />
            </label>
            <label className="space-y-1 text-sm font-medium">
              调用标识
              <Input
                value={identifier}
                maxLength={40}
                readOnly={Boolean(skill)}
                placeholder="如 code-review"
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              分类
              <Select
                value={category}
                onChange={(event) => setCategory(event.target.value as SkillListItem['category'])}
              >
                {SKILL_CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              内容版本
              <Input
                value={contentVersion}
                maxLength={20}
                placeholder="1.0.0"
                onChange={(event) => setContentVersion(event.target.value)}
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm font-medium">
            简述
            <Input value={summary} maxLength={100} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            SKILL.md 指令
            <Textarea
              value={content}
              maxLength={6000}
              rows={10}
              className="font-mono text-xs"
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">请勿在技能中写入密钥、访问令牌或平台凭据；只引用凭据名称。</p>
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
              {mutation.isPending ? '提交中…' : skill ? '保存修改' : '发布到团队'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
