import { useState } from 'react'
import { Download, FileCode2, FilePlus2, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/lib/utils'
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
 * 技能资源文件双栏编辑器：左侧文件树、右侧内联编辑/预览面板，不再嵌套弹窗。
 * @param props.files 当前文件草稿列表。
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
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle')
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const totalBytes = files.reduce((total, file) => total + skillFileSize(file), 0)
  const activeFile = editingPath ? files.find((item) => item.path === editingPath) : undefined

  const openCreate = () => {
    setMode('create')
    setEditingPath(null)
    setPath('')
    setContent('')
    setError('')
  }

  const selectFile = (file: SkillFileDraft) => {
    setEditingPath(file.path)
    setPath(file.path)
    setContent(file.content)
    setError('')
    setMode(!disabled && isEditableSkillFile(file.path, file.content, file.encoding) ? 'edit' : 'idle')
  }

  const remove = (targetPath: string) => {
    onChange(files.filter((file) => file.path !== targetPath))
    if (editingPath === targetPath) {
      setMode('idle')
      setEditingPath(null)
      setPath('')
      setContent('')
      setError('')
    }
  }

  const download = (file: SkillFileDraft) => {
    if (file.encoding === 'base64') {
      downloadBlob(file.path.split('/').pop() ?? 'file', blobFromBytes(base64ToBytes(file.content)))
    } else {
      downloadBlob(file.path.split('/').pop() ?? 'file', new Blob([file.content], { type: 'text/plain;charset=utf-8' }))
    }
    showToast('已开始下载资源文件', 'success')
  }

  const saveDraft = () => {
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
    if (files.some((file) => file.path === nextPath && file.path !== editingPath)) {
      setError('资源文件路径重复。')
      return
    }
    const nextFile: SkillFileDraft = { path: nextPath, content, encoding: 'utf8' }
    const nextFiles =
      mode === 'create'
        ? [...files, nextFile]
        : files.map((file) => (file.path === editingPath ? nextFile : file))
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
    setEditingPath(nextPath)
    setMode('edit')
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
            <FilePlus2 className="size-4" aria-hidden="true" />
            添加文件
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        支持 scripts/、references/、assets/ 等目录；左侧选择文件，右侧直接编辑或预览，无需嵌套弹窗。
      </p>

      {files.length === 0 && mode !== 'create' ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          暂未添加资源文件。可点击上方「导入技能包目录」批量导入，或点击「添加文件」手动新建文本文件。
        </div>
      ) : (
        <div className="skill-file-browser">
          <div className="skill-file-tree" role="list" aria-label="资源文件列表">
            {files.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">正在新建第一个资源文件…</p>
            ) : (
              files.map((file) => {
                const isActive = mode !== 'create' && editingPath === file.path
                return (
                  <div
                    key={file.path}
                    role="listitem"
                    className={cn('skill-file-tree-row', isActive && 'is-active')}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="skill-file-tree-btn"
                      onClick={() => selectFile(file)}
                    >
                      <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                    </Button>
                    <Tag variant={file.encoding === 'utf8' ? 'neutral' : 'blue'}>
                      {file.encoding === 'utf8' ? '文本' : '二进制'}
                    </Tag>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`下载 ${file.path}`}
                      onClick={() => download(file)}
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                    </Button>
                    {!disabled && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除 ${file.path}`}
                        onClick={() => remove(file.path)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="skill-file-preview">
            {mode === 'create' || mode === 'edit' ? (
              <div className="skill-file-editor-pane">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {mode === 'create' ? '新建资源文件' : `编辑 ${editingPath}`}
                  </span>
                  {activeFile && (
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(skillFileSize(activeFile))}
                    </span>
                  )}
                </div>
                <label className="block space-y-1 text-xs font-medium">
                  相对路径
                  <Input
                    value={path}
                    maxLength={200}
                    placeholder="如 references/checklist.md"
                    readOnly={mode === 'edit'}
                    onChange={(event) => setPath(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-xs font-medium">
                  文件内容
                  <Textarea
                    value={content}
                    rows={10}
                    className="font-mono text-xs"
                    onChange={(event) => setContent(event.target.value)}
                  />
                </label>
                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMode('idle')
                      setError('')
                    }}
                  >
                    取消
                  </Button>
                  <Button type="button" size="sm" onClick={saveDraft}>
                    保存文件
                  </Button>
                </div>
              </div>
            ) : activeFile ? (
              <>
                <div className="skill-file-preview-head">
                  <code className="min-w-0 truncate text-xs font-medium">{activeFile.path}</code>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatFileSize(skillFileSize(activeFile))}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => download(activeFile)}>
                      <Download className="size-3.5" aria-hidden="true" />
                      下载
                    </Button>
                  </div>
                </div>
                <pre className="skill-file-preview-body font-mono">
                  {activeFile.encoding === 'utf8'
                    ? activeFile.content
                    : '二进制资源文件不支持在线文本编辑，可点击右上角下载核对。'}
                </pre>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
                在左侧点击任意资源文件即可编辑或预览，或点击「添加文件」创建新文件。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
