import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { signInEmail } from '../api/auth-client'
import { sessionQueryOptions } from '../api/queries'

/** 邮箱密码登录表单；成功后回跳原受保护页面。 */
export function LoginForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => signInEmail(email.trim(), password),
    onSuccess: async () => {
      // 登录成功的会话必须写回缓存后再跳转：受保护路由会读取会话，
      // 若此时缓存仍是登录前的 null，会把刚登录的用户再次重定向到登录页。
      await queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey, type: 'all' })
      const redirect = params.get('redirect')
      navigate(redirect && redirect.startsWith('/') ? redirect : '/projects', { replace: true })
    },
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。'),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('请填写邮箱和密码。')
      return
    }
    mutation.mutate()
  }
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <label className="block space-y-1.5 text-sm font-medium">
        邮箱
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        密码
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? '登录中…' : '登录'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <a className="text-primary hover:underline" href="/forgot-password">
          忘记密码？
        </a>
      </p>
    </form>
  )
}
