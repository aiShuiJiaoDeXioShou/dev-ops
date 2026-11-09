import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import type { TeamRole } from '../model/session'

const ROLE_LABELS: Record<TeamRole, string> = { admin: '管理员', developer: '开发者', viewer: '浏览者' }

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
      const message = isBusinessError(cause) ? cause.message : '邀请失败，请稍后重试。'
      setError(message)
      showToast(message)
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
