import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'

/** 平台 root 创建团队并邀请首位管理员。 */
export function CreateTeamForm() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => apiClient.createTeam({ name: name.trim(), adminEmail: adminEmail.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity', 'teams'] })
      setOpen(false)
      setMessage(`团队已创建，邀请邮件已发送至 ${adminEmail.trim()}。`)
      setName('')
      setAdminEmail('')
    },
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '创建团队失败。'),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) return setError('请填写团队名称。')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) return setError('请输入管理员邮箱。')
    mutation.mutate()
  }
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">创建团队</h2>
          <p className="mt-1 text-sm text-muted-foreground">平台管理员创建团队并邀请首位管理员。</p>
        </div>
        <Button type="button" onClick={() => setOpen(true)}>
          创建团队
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>创建团队</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              团队名称
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              首位管理员邮箱
              <Input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? '创建中…' : '创建并邀请'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
