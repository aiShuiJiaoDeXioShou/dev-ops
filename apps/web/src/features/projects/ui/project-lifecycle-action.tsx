import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/controls/alert-dialog'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'

const actions = {
  remove: {
    label: '移入回收站',
    description: '项目会从日常列表和统计中移除。团队管理员可以从回收站恢复，业务记录和文件会保留。',
    success: '项目已移入回收站。',
  },
  restore: {
    label: '恢复项目',
    description: '项目会重新出现在列表中，保留原有名称、状态和历史。已经清理的文件仍不可用。',
    success: '项目已恢复。',
  },
  cleanup: {
    label: '清理项目文件',
    description: '删除平台托管的项目附件和流水线产物。恢复项目时不会还原这些文件，业务记录和日志会保留。',
    success: '项目文件清理已提交。',
  },
} as const

/**
 * 对指定项目进行二次确认。密码只在提交时读取，请求结束即清空。
 * @param props 项目版本、操作类型、按钮状态及用于刷新列表和归还焦点的回调。
 * @returns 操作按钮与确认弹窗。
 */
export function ProjectLifecycleAction({
  project,
  action,
  label,
  disabled,
  onDone,
  focusAfterSuccess,
}: {
  project: { id: string; name: string; version: number }
  action: keyof typeof actions
  label?: string
  disabled?: boolean
  onDone: () => void
  focusAfterSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const completed = useRef(false)
  const submitting = useRef(false)
  const { showToast } = useToast()
  const client = useQueryClient()
  const current = actions[action]
  const requiresPassword = action !== 'restore'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const password = passwordInput.current?.value ?? ''
    if (requiresPassword && !password) {
      setError('请输入当前登录密码。')
      passwordInput.current?.focus()
      return
    }
    if (passwordInput.current) passwordInput.current.value = ''
    submitting.current = true
    setPending(true)
    setError('')
    try {
      const input = { version: project.version }
      if (action === 'remove') await apiClient.removeProject(project.id, { ...input, password })
      if (action === 'restore') await apiClient.restoreProject(project.id, input)
      if (action === 'cleanup') await apiClient.cleanupProjectFiles(project.id, { ...input, password })
      completed.current = true
      setOpen(false)
      showToast(current.success, 'success')
      onDone()
    } catch (cause) {
      setError(describeRequestError(cause).description)
      if (isBusinessError(cause, 'VERSION_CONFLICT')) {
        void client.invalidateQueries({ queryKey: ['projects'] })
      }
      // 输入框随提交状态解除禁用，用下一帧归还焦点。
      requestAnimationFrame(() => passwordInput.current?.focus())
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (submitting.current) return
        if (next) {
          completed.current = false
          setError('')
        }
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant={requiresPassword ? 'destructive' : 'outline'}
          className="min-h-11 sm:min-h-8"
          disabled={disabled}
        >
          {label ?? current.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="max-h-dvh overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (submitting.current) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (completed.current && focusAfterSuccess) focusAfterSuccess()
          else trigger.current?.focus()
        }}
      >
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{current.label}</AlertDialogTitle>
            <AlertDialogDescription>{current.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 wrap-anywhere">
            <p className="text-sm font-medium">{project.name}</p>
            <p className="text-xs text-muted-foreground">项目 ID {project.id}</p>
          </div>
          {requiresPassword && (
            <label className="field">
              当前登录密码
              <Input
                ref={passwordInput}
                type="password"
                autoComplete="current-password"
                maxLength={128}
                className="text-base sm:text-sm"
                disabled={pending}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <Button type="submit" variant={requiresPassword ? 'destructive' : 'default'} disabled={pending}>
              {pending ? '提交中…' : `确认${current.label}`}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
