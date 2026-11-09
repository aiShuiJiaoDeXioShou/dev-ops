import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey } from '@dev-ops/api-client'
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
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'

interface ProjectFormProps {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (projectId: string) => void
}

/** 创建项目对话框；统一使用工作区弹窗样式和底部提示。 */
export function ProjectForm({ teamId, open, onOpenChange, onCreated }: ProjectFormProps) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createProject(
        teamId,
        { name: name.trim(), description: description.trim() || null },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setName('')
      setDescription('')
      setError('')
      showToast('项目已创建', 'success')
      onOpenChange(false)
      onCreated?.(result.data.id)
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      setError(message)
      showToast(message, 'error')
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('请填写项目名称。')
      return
    }
    mutation.mutate()
  }
  const close = () => {
    setError('')
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(540px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>创建项目</DialogTitle>
          <DialogDescription>项目用于组织团队的需求、Bug 和代码协作记录。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <label className="block space-y-1.5 text-sm font-medium">
            项目名称
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            项目说明
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              placeholder="简要说明项目目标与范围"
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
              {mutation.isPending ? '创建中…' : '创建项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
