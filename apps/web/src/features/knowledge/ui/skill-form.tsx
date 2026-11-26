import { useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import type { ApiBody } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderUp } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { knowledgeMutations } from '../api/mutations'
import { SKILL_CATEGORY_OPTIONS } from '../model/labels'
import type { ImportedSkillPackage, SkillDetail, SkillFileDraft, SkillListItem } from '../model/types'
import { pickSkillDirectory, readSkillPackageDirectory } from '../lib/skill-package'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { SkillFilesEditor } from './skill-files-editor'

type CreateBody = ApiBody<'/api/v1/teams/{teamId}/skills', 'post'>
type UpdateBody = ApiBody<'/api/v1/skills/{skillId}/update', 'post'>

/** 计算下一修订版本号，方便编辑正文或资源文件时一键递增。 */
function bumpPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return '1.0.1'
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

/**
 * 可复用的技能编辑表单主体：支持在新建弹窗和详情抽屉内嵌编辑态复用，避免多层弹窗嵌套。
 * @param props.teamId 团队标识。
 * @param props.skill 待编辑的技能；为空时表示新建发布。
 * @param props.initialImported 通过「导入目录」预填的技能包草稿。
 * @param props.onCancel 取消回调。
 * @param props.onSaved 保存成功回调。
 * @param props.inDialog 是否渲染在 Dialog 表单壳中。
 */
export function SkillEditorFields({
  teamId,
  skill,
  initialImported,
  onCancel,
  onSaved,
  inDialog = false,
}: {
  teamId: string
  skill?: SkillDetail | null
  initialImported?: ImportedSkillPackage | null
  onCancel: () => void
  onSaved: () => void
  inDialog?: boolean
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState(skill?.name ?? initialImported?.frontmatterName ?? '')
  const [identifier, setIdentifier] = useState(skill?.identifier ?? initialImported?.frontmatterName ?? '')
  const [category, setCategory] = useState<SkillListItem['category']>(skill?.category ?? 'engineering')
  const [contentVersion, setContentVersion] = useState(skill?.contentVersion ?? '1.0.0')
  const [summary, setSummary] = useState(skill?.summary ?? initialImported?.summary ?? '')
  const [content, setContent] = useState(skill?.content ?? initialImported?.body ?? '')
  const [files, setFiles] = useState<SkillFileDraft[]>(() => {
    if (skill) {
      return skill.files.map((file) => ({ path: file.path, content: file.content, encoding: file.encoding }))
    }
    return initialImported?.files ?? []
  })
  const [error, setError] = useState('')

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
      onSaved()
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
      if (imported.frontmatterName && !skill) {
        if (!identifier.trim()) setIdentifier(imported.frontmatterName)
        if (!name.trim()) setName(imported.frontmatterName.slice(0, 30))
      }
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

  const fieldsContent = (
    <div className="space-y-4">
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
          <Select value={category} onChange={(event) => setCategory(event.target.value as SkillListItem['category'])}>
            {SKILL_CATEGORY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="flex items-center justify-between gap-2">
            <span>内容版本</span>
            {skill && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setContentVersion(bumpPatchVersion(contentVersion))}
              >
                递增版本
              </Button>
            )}
          </span>
          <Input
            value={contentVersion}
            maxLength={20}
            placeholder="1.0.0"
            onChange={(event) => setContentVersion(event.target.value)}
          />
        </label>
        <label className="field full">
          简述
          <Input
            value={summary}
            maxLength={100}
            placeholder="一句话说明适用场景与产出"
            onChange={(event) => setSummary(event.target.value)}
          />
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
          <FolderUp className="size-4" aria-hidden="true" />
          导入技能包目录
        </Button>
        <span className="text-xs text-muted-foreground">
          支持包含 SKILL.md、scripts/、references/、assets/ 的目录；修改正文或文件时需递增内容版本号。
        </span>
      </div>
      <SkillFilesEditor files={files} onChange={setFiles} />
      <p className="text-xs text-muted-foreground">请勿在技能中写入密钥、访问令牌或平台凭据；只引用凭据名称。</p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )

  const footerActions = (
    <>
      <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onCancel}>
        取消
      </Button>
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? '提交中…' : skill ? '保存修改' : '发布到团队'}
      </Button>
    </>
  )

  if (inDialog) {
    return (
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <DialogFormHeader>
          <DialogTitle>{skill ? '编辑 Skill' : '发布团队 Skill'}</DialogTitle>
        </DialogFormHeader>
        <DialogFormBody>{fieldsContent}</DialogFormBody>
        <DialogFormFooter>{footerActions}</DialogFormFooter>
      </form>
    )
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {fieldsContent}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">{footerActions}</div>
    </form>
  )
}

/**
 * 技能发布与编辑弹窗，支持 SKILL.md 正文与资源文件包。
 * @param props.teamId 团队标识。
 * @param props.open 弹窗开关。
 * @param props.onOpenChange 开关状态变化回调。
 * @param props.skill 待编辑技能；新建时不传。
 * @param props.initialImported 预导入的技能包草稿。
 */
export function SkillForm({
  teamId,
  open,
  onOpenChange,
  skill,
  initialImported,
}: {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  skill?: SkillDetail | null
  initialImported?: ImportedSkillPackage | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="form" className="knowledge-dialog w-full max-w-4xl">
        {open && (
          <SkillEditorFields
            key={
              skill?.id ??
              (initialImported
                ? `import:${initialImported.frontmatterName ?? 'dir'}:${initialImported.files.length}`
                : 'new')
            }
            teamId={teamId}
            skill={skill}
            initialImported={initialImported}
            inDialog
            onCancel={() => onOpenChange(false)}
            onSaved={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
