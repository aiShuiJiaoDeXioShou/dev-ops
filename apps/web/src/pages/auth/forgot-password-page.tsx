import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { requestPasswordReset } from '@/features/identity/public'

/** 请求密码重置邮件；沿用认证卡片布局。 */
export function Component() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await requestPasswordReset(email.trim())
      setMessage('如果邮箱存在，重置邮件已发送。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发送失败，请稍后重试。')
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
        <h1>找回密码</h1>
        <p className="auth-sub">输入受邀邮箱，重置链接将发送到该邮箱。</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
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
          <button type="submit" className="login-submit" disabled={pending}>
            {pending ? '发送中…' : '发送重置邮件'}
          </button>
        </form>
        <p className="auth-footer">
          <Link to="/login">返回登录</Link>
        </p>
      </main>
    </div>
  )
}

export default Component
