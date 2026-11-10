import { useEffect, useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import type { ApiBody } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderUp } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { knowledgeMutations } from '../api/mutations'
import { SKILL_CATEGORY_OPTIONS } from '../model/labels'
import type { SkillDetail, SkillFileDraft, SkillListItem } from '../model/types'
import { pickSkillDirectory, readSkillPackageDirectory } from '../lib/skill-package'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { SkillFilesEditor } from './skill-files-editor'

type CreateBody = ApiBody<'/api/v1/teams/{teamId}/skills', 'post'>
type UpdateBody = ApiBody<'/api/v1/skills/{skillId}/update', 'post'>

/** 技能发布与编辑表单，支持 SKILL.md 正文与资源文件包。 */
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
  const [files, setFiles] = useState<SkillFileDraft[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(skill?.name ?? '')
    setIdentifier(skill?.identifier ?? '')
    setCategory(skill?.category ?? 'engineering')
    setContentVersion(skill?.contentVersion ?? '1.0.0')
    setSummary(skill?.summary ?? '')
    setContent(skill?.content ?? '')
    setFiles((skill?.files ?? []).map((file) => ({ path: file.path, content: file.content, encoding: file.encoding })))
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
        files: files.map((file) => ({ path: file.path, content: file.content, encoding: file.encoding })),
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

  const importDirectory = async () => {
    const fileList = await pickSkillDirectory()
    if (!fileList || fileList.length === 0) return
    try {
      const imported = await readSkillPackageDirectory(fileList)
      if (imported.frontmatterName && !skill) setIdentifier(imported.frontmatterName)
      if (imported.summary) setSummary(imported.summary)
      setContent(imported.body)
      setFiles(imported.files)
      showToast(`已导入技能包：${imported.body.length} 字符正文，${imported.files.length} 个资源文件`, 'success')
    } catch (cause: unknown) {
      showToast(cause instanceof Error ? cause.message : '技能包导入失败。', 'error')
    }
  }

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
      <DialogContent className="knowledge-dialog w-full max-w-3xl">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{skill ? '编辑 Skill' : '发布团队 Skill'}</DialogTitle>
          </DialogHeader>
          <div className="form-grid">
            <label className="field">
              名称
              <Input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} autoFocus />
            </label>
            <label className="field">
              调用标识
              <Input
                value={identifier}
                maxLength={40}
                readOnly={Boolean(skill)}
                placeholder="如 code-review"
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </label>
            <label className="field">
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
            <label className="field">
              内容版本
              <Input
                value={contentVersion}
                maxLength={20}
                placeholder="1.0.0"
                onChange={(event) => setContentVersion(event.target.value)}
              />
            </label>
            <label className="field full">
              简述
              <Input value={summary} maxLength={100} onChange={(event) => setSummary(event.target.value)} />
            </label>
            <label className="field full">
              SKILL.md 正文
              <Textarea
                value={content}
                maxLength={50000}
                rows={12}
                className="font-mono text-xs"
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void importDirectory()}>
              <FolderUp className="size-4" />
              导入技能包目录
            </Button>
            <span className="text-xs text-muted-foreground">
              支持包含 SKILL.md、scripts/、references/、assets/ 的目录；图片等二进制文件将转为可下载资源。
            </span>
          </div>
          <SkillFilesEditor files={files} onChange={setFiles} />
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
