import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { resetPassword } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'

/** 使用重置令牌设置新密码。 */
export function Component() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!token) return setError('重置链接缺少 token。')
    if (password.length < 8) return setError('密码至少 8 个字符。')
    if (password !== confirm) return setError('两次输入的密码不一致。')
    setPending(true)
    try {
      await resetPassword(token, password)
      setMessage('密码已更新，请返回登录。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重置失败，请稍后重试。')
    } finally {
      setPending(false)
    }
  }
  return (
    <main className="grid min-h-svh place-items-center bg-muted/40 p-6">
      <form className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-7 shadow-sm" onSubmit={submit}>
        <h1 className="text-xl font-semibold">设置新密码</h1>
        <Input
          type="password"
          placeholder="新密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          type="password"
          placeholder="确认新密码"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {message && (
          <p role="status" className="text-sm text-success">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? '提交中…' : '更新密码'}
        </Button>
        <p className="text-center text-sm">
          <a className="text-primary hover:underline" href="/login">
            返回登录
          </a>
        </p>
      </form>
    </main>
  )
}

export default Component
