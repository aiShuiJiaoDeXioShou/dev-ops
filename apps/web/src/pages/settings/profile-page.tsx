import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ApiTokenSection,
  changePassword,
  sessionQueryOptions,
  updateUserName,
  useSession,
} from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'

/** 个人页面：账号资料、密码修改与 API Token 管理。 */
export function Component() {
  const { user, currentTeam } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState(user.name)
  const [savingName, setSavingName] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  const submitName = async (event: FormEvent) => {
    event.preventDefault()
    const next = name.trim()
    if (!next) return showToast('姓名不能为空', 'error')
    if (next === user.name) return showToast('姓名没有变化', 'info')
    setSavingName(true)
    try {
      await updateUserName(next)
      await queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey })
      showToast('姓名已更新', 'success')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '姓名更新失败', 'error')
    } finally {
      setSavingName(false)
    }
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setPasswordError('')
    if (currentPassword.length === 0) return setPasswordError('请输入当前密码。')
    if (newPassword.length < 8) return setPasswordError('新密码至少 8 个字符。')
    if (newPassword !== confirmPassword) return setPasswordError('两次输入的新密码不一致。')
    setSavingPassword(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('密码已更新', 'success')
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : '密码修改失败，请稍后重试。')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="catalog min-w-0 space-y-8">
      <h1 className="text-lg font-semibold">个人页面</h1>

      <section className="min-w-0 space-y-4" aria-labelledby="account-title">
        <h2 id="account-title" className="text-base font-semibold">
          账号
        </h2>
        <div className="rounded-xl border bg-card p-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">姓名</dt>
              <dd className="mt-1 text-sm font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">邮箱</dt>
              <dd className="mt-1 text-sm font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">当前团队</dt>
              <dd className="mt-1 text-sm font-medium">{currentTeam?.name ?? '未加入团队'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="min-w-0 space-y-4" aria-labelledby="profile-edit-title">
        <h2 id="profile-edit-title" className="text-base font-semibold">
          资料维护
        </h2>
        <form className="rounded-xl border bg-card p-5" onSubmit={(event) => void submitName(event)}>
          <label className="field max-w-sm">
            显示名称
            <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="mt-4">
            <Button type="submit" disabled={savingName}>
              {savingName ? '保存中…' : '保存名称'}
            </Button>
          </div>
        </form>
      </section>

      <section className="min-w-0 space-y-4" aria-labelledby="password-title">
        <h2 id="password-title" className="text-base font-semibold">
          修改密码
        </h2>
        <form className="rounded-xl border bg-card p-5" onSubmit={(event) => void submitPassword(event)}>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
            <label className="field">
              当前密码
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="field">
              新密码
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="field">
              确认新密码
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          </div>
          {passwordError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {passwordError}
            </p>
          )}
          <div className="mt-4">
            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? '提交中…' : '更新密码'}
            </Button>
          </div>
        </form>
      </section>

      <ApiTokenSection />
    </div>
  )
}

export default Component
