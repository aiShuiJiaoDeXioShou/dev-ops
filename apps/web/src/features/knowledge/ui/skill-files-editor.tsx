import { useState, type FormEvent } from 'react'
import { FilePlus2, Pencil, Trash2, Download } from 'lucide-react'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import type { SkillFileDraft } from '../model/types'
import {
  SKILL_FILE_LIMITS,
  base64ToBytes,
  blobFromBytes,
  downloadBlob,
  formatFileSize,
  isEditableSkillFile,
  skillFileSize,
} from '../lib/skill-package'

/** 校验资源文件路径的客户端规则；服务端仍为最终校验。 */
const PATH_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

/**
 * 技能资源文件编辑器：展示 scripts/references/assets 等文件，支持新增、编辑文本与下载。
 * @param props.files 当前文件草稿。
 * @param props.onChange 文件变化回调。
 * @param props.disabled 只读时禁止编辑。
 */
export function SkillFilesEditor({
  files,
  onChange,
  disabled = false,
}: {
  files: SkillFileDraft[]
  onChange: (files: SkillFileDraft[]) => void
  disabled?: boolean
}) {
  const { showToast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const totalBytes = files.reduce((total, file) => total + skillFileSize(file), 0)

  const openCreate = () => {
    setEditingIndex(null)
    setPath('')
    setContent('')
    setError('')
    setFormOpen(true)
  }
  const openEdit = (index: number) => {
    const file = files[index]
    if (!file) return
    setEditingIndex(index)
    setPath(file.path)
    setContent(file.content)
    setError('')
    setFormOpen(true)
  }
  const remove = (index: number) => {
    onChange(files.filter((_, current) => current !== index))
  }
  const download = (file: SkillFileDraft) => {
    if (file.encoding === 'base64') {
      downloadBlob(file.path.split('/').pop() ?? 'file', blobFromBytes(base64ToBytes(file.content)))
    } else {
      downloadBlob(file.path.split('/').pop() ?? 'file', new Blob([file.content], { type: 'text/plain;charset=utf-8' }))
    }
    showToast('已开始下载资源文件', 'success')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const nextPath = path.trim()
    const segments = nextPath.split('/')
    if (
      !PATH_PATTERN.test(nextPath) ||
      segments.length === 0 ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      setError('路径只能包含字母、数字、点、下划线、连字符和目录斜杠，且不能包含穿越段。')
      return
    }
    if (nextPath.toLowerCase() === 'skill.md') {
      setError('SKILL.md 由技能正文维护，不需要重复添加。')
      return
    }
    if (content.length === 0) {
      setError('请填写文件内容。')
      return
    }
    if (content.length > SKILL_FILE_LIMITS.textMaxLength) {
      setError(`单个文本文件不能超过 ${SKILL_FILE_LIMITS.textMaxLength} 个字符。`)
      return
    }
    if (files.some((file, index) => file.path === nextPath && index !== editingIndex)) {
      setError('资源文件路径重复。')
      return
    }
    const nextFile: SkillFileDraft = { path: nextPath, content, encoding: 'utf8' }
    const nextFiles =
      editingIndex === null
        ? [...files, nextFile]
        : files.map((file, index) => (index === editingIndex ? nextFile : file))
    if (nextFiles.length > SKILL_FILE_LIMITS.maxCount) {
      setError(`资源文件最多 ${SKILL_FILE_LIMITS.maxCount} 个。`)
      return
    }
    const nextTotal = nextFiles.reduce((total, file) => total + skillFileSize(file), 0)
    if (nextTotal > SKILL_FILE_LIMITS.totalMaxBytes) {
      setError(`资源文件总大小不能超过 ${formatFileSize(SKILL_FILE_LIMITS.totalMaxBytes)}。`)
      return
    }
    onChange(nextFiles.sort((left, right) => left.path.localeCompare(right.path)))
    setFormOpen(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">资源文件</span>
        <span className="text-xs text-muted-foreground">
          {files.length}/{SKILL_FILE_LIMITS.maxCount} · {formatFileSize(totalBytes)}
        </span>
        <span className="flex-1" />
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            <FilePlus2 className="size-4" />
            添加文件
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        可包含 scripts/、references/、assets/ 等目录；文本文件可直接编辑，二进制文件通过目录导入后仅可下载。
      </p>
      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          暂未添加资源文件。可以在技能表单中导入完整目录，或手动添加文本文件。
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li key={file.path} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-xs">{file.path}</code>
              <Tag variant={file.encoding === 'utf8' ? 'neutral' : 'blue'}>
                {file.encoding === 'utf8' ? '文本' : '二进制'}
              </Tag>
              <span className="text-xs text-muted-foreground">{formatFileSize(skillFileSize(file))}</span>
              {!disabled && isEditableSkillFile(file.path, file.content, file.encoding) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`编辑 ${file.path}`}
                  onClick={() => openEdit(index)}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`下载 ${file.path}`}
                onClick={() => download(file)}
              >
                <Download className="size-4" />
              </Button>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除 ${file.path}`}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="knowledge-dialog w-full max-w-xl">
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editingIndex === null ? '添加资源文件' : '编辑资源文件'}</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1 text-sm font-medium">
              相对路径
              <Input
                value={path}
                maxLength={200}
                placeholder="如 references/checklist.md"
                readOnly={editingIndex !== null}
                onChange={(event) => setPath(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              文件内容
              <Textarea
                value={content}
                rows={12}
                className="font-mono text-xs"
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存文件</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
