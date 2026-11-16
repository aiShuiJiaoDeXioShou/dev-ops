import { useRef, useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'
import { changePassword } from '../api/auth-client'

/**
 * 提供登录账号的密码修改入口，关闭后销毁密码输入框。
 * @returns 修改密码按钮和保存弹窗，失败时保留表单以供重试。
 */
export function ChangePasswordDialog() {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  const changeOpen = (next: boolean) => {
    if (isSaving) return
    setError('')
    setOpen(next)
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return
    const form = new FormData(event.currentTarget)
    const current = String(form.get('currentPassword') ?? '')
    const next = String(form.get('newPassword') ?? '')
    if (!current) return setError('请输入当前密码。')
    if (next.length < 8) return setError('新密码至少 8 个字符。')
    if (next !== form.get('confirmPassword')) return setError('两次输入的新密码不一致。')
    setError('')
    setIsSaving(true)
    try {
      await changePassword(current, next)
      setOpen(false)
      showToast('密码已更新。', 'success')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '密码修改失败，请稍后重试。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button ref={trigger} variant="outline" className="min-h-11 sm:min-h-9">
          修改密码
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={!isSaving}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <fieldset className="space-y-4" disabled={isSaving}>
            <label className="field">
              当前密码
              <Input name="currentPassword" type="password" autoComplete="current-password" />
            </label>
            <label className="field">
              新密码
              <Input name="newPassword" type="password" autoComplete="new-password" />
            </label>
            <label className="field">
              确认新密码
              <Input name="confirmPassword" type="password" autoComplete="new-password" />
            </label>
          </fieldset>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => changeOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '提交中…' : '更新密码'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
