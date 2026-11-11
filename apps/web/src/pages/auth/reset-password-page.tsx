import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
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
    <div className="auth-shell">
      <main className="auth-card">
        <a className="auth-brand" href="/login" aria-label="返回登录">
          <img src="/prototype/brand.svg" width={29} height={29} alt="" />
          DevOps
        </a>
        <h1>设置新密码</h1>
        <p className="auth-sub">设置新的登录密码后返回工作台。</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            新密码
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="h-11"
            />
          </label>
          <label className="field">
            确认密码
            <Input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              className="h-11"
            />
          </label>
          {message && (
            <p className="field-success" role="status">
              {message}
            </p>
          )}
          <div className="auth-error-slot" aria-live="polite">
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="login-submit" disabled={pending}>
            {pending ? '提交中…' : '更新密码'}
          </Button>
        </form>
        <p className="auth-footer">
          <Link to="/login">返回登录</Link>
        </p>
      </main>
    </div>
  )
}

export default Component
