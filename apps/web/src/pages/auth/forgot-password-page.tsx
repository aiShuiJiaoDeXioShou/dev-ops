import { useState, type FormEvent } from 'react'
import { requestPasswordReset } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'

/** 请求密码重置邮件。 */
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
    <main className="grid min-h-svh place-items-center bg-muted/40 p-6">
      <form className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-7 shadow-sm" onSubmit={submit}>
        <h1 className="text-xl font-semibold">找回密码</h1>
        <Input type="email" placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
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
          {pending ? '发送中…' : '发送重置邮件'}
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
