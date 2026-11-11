import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { DelayedPageLoading } from '@/shared/ui/page-state'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { sessionQueryOptions } from '../api/queries'

/**
 * 将接受邀请的失败原因转换成用户可执行的说明。
 * @param cause 请求异常。
 * @returns 针对已有账号、邀请失效和密码问题的具体提示。
 */
function invitationAcceptErrorMessage(cause: unknown): string {
  if (!isBusinessError(cause)) return '接受邀请失败，请检查网络后重试。'
  switch (cause.serverCode) {
    case 'UNAUTHENTICATED':
      return '该邮箱已有账号，请填写原账号密码；如果忘记密码，请先通过“忘记密码”重置。'
    case 'INVITATION_ALREADY_ACCEPTED':
      return '该邀请已被接受，或该邮箱已经是团队成员。'
    case 'INVITATION_INVALID':
      return '邀请无效或已过期，请联系团队管理员重新发送。'
    case 'VALIDATION_ERROR':
      return describeRequestError(cause).description
    case 'PRECONDITION_FAILED':
      return '账号创建失败，请确认邮箱是否已有账号；如果已有账号，请填写原密码后重试。'
    default:
      return describeRequestError(cause).description
  }
}

/** 接受邀请并设置首次密码；邀请页面公开访问。 */
export function AcceptInvitationForm() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invitation = useQuery({
    queryKey: ['identity', 'invitation', token],
    queryFn: () => apiClient.getInvitation(token),
    enabled: Boolean(token),
    retry: false,
  })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => apiClient.acceptInvitation(token, { name: name.trim(), password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey })
      navigate('/projects', { replace: true })
    },
    onError: (cause: unknown) => {
      setError(invitationAcceptErrorMessage(cause))
    },
  })
  if (!token)
    return (
      <p role="alert" className="text-sm text-destructive">
        邀请链接缺少 token。
      </p>
    )
  if (invitation.isPending) return <DelayedPageLoading />
  if (invitation.isError || !invitation.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        邀请无效或已过期，请联系团队管理员重新发送。
      </p>
    )
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (name.trim().length === 0) return setError('请填写显示名称。')
    if (password.length < 8) return setError('密码至少 8 个字符。')
    if (password !== confirm) return setError('两次输入的密码不一致。')
    mutation.mutate()
  }
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="info-box">
        加入团队 <strong>{invitation.data.data.teamName}</strong>，角色：{invitation.data.data.role}
      </div>
      <label className="field">
        显示名称
        <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="h-11" />
      </label>
      <label className="field">
        密码
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="h-11"
        />
      </label>
      <p className="field-hint">
        已有账号请填写原账号密码；新账号会使用该密码创建。忘记密码可
        <Link to="/forgot-password">先找回密码</Link>。
      </p>
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
      <div className="auth-error-slot" aria-live="polite">
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" className="login-submit" disabled={mutation.isPending}>
        {mutation.isPending ? '加入中…' : '加入团队'}
      </Button>
    </form>
  )
}
