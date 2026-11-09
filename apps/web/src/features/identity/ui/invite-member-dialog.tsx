import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import type { TeamRole } from '../model/session'

const ROLE_LABELS: Record<TeamRole, string> = { admin: '管理员', developer: '开发者', viewer: '浏览者' }

/**
 * 将邀请接口的业务错误转换成可执行的说明，避免只显示通用状态错误。
 * @param cause 请求异常。
 * @returns 针对重复邀请、成员已存在和邮件失败的具体提示。
 */
function invitationErrorMessage(cause: unknown): string {
  if (!isBusinessError(cause)) return '邀请发送失败，请稍后重试。'
  switch (cause.serverCode) {
    case 'DUPLICATE_RELATION':
      return '该邮箱已有待接受邀请。请等待对方接受，或先撤销原邀请后重新发送。'
    case 'INVITATION_ALREADY_ACCEPTED':
      return '该邮箱已经是团队成员，无需重复邀请。'
    case 'PRECONDITION_FAILED':
      return '邀请状态已变化，请刷新成员与邀请列表后重试。'
    case 'EMAIL_DELIVERY_FAILED':
      return '邀请已创建，但邀请邮件发送失败。请稍后重新发送。'
    default:
      return describeRequestError(cause).description
  }
}

/** 邀请成员加入团队。 */
export function InviteMemberDialog({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('developer')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => apiClient.inviteTeamMember(teamId, { email: email.trim(), role }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity', 'invitations', teamId] })
      setEmail('')
      onOpenChange(false)
    },
    onError: (cause: unknown) => {
      const message = invitationErrorMessage(cause)
      setError(message)
      showToast(message, 'error')
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('请输入合法邮箱。')
    mutation.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>邀请成员</DialogTitle>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            邮箱
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            角色
            <Select value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '发送中…' : '发送邀请'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
