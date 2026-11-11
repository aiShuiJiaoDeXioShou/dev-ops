import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'

/**
 * 平台 root 创建团队并邀请首位管理员。
 * @param props 打开状态与变更回调。
 * @returns 统一风格的创建团队弹窗。
 */
export function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => apiClient.createTeam({ name: name.trim(), adminEmail: adminEmail.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity', 'teams'] })
      onOpenChange(false)
      setName('')
      setAdminEmail('')
      showToast(`团队已创建，邀请邮件已发送至 ${adminEmail.trim()}。`, 'success')
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      setError(message)
      showToast(message, 'error')
    },
  })
  const close = () => {
    setError('')
    onOpenChange(false)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) return setError('请填写团队名称。')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) return setError('请输入管理员邮箱。')
    mutation.mutate()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="dialog-w-md">
        <DialogHeader>
          <DialogTitle>创建团队</DialogTitle>
          <DialogDescription>创建团队后，平台会向首位管理员发送邀请邮件。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <label className="block space-y-1.5 text-sm font-medium">
            团队名称
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            首位管理员邮箱
            <Input
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="name@company.com"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '创建中…' : '创建并邀请'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
