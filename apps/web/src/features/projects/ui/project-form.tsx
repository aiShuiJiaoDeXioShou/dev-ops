import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'

interface ProjectFormProps {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (projectId: string) => void
}

/** 创建项目对话框；创建成功后刷新项目列表。 */
export function ProjectForm({ teamId, open, onOpenChange, onCreated }: ProjectFormProps) {
  const queryClient = useQueryClient()
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
      onOpenChange(false)
      onCreated?.(result.data.id)
    },
    onError: (cause: unknown) => setError(describeRequestError(cause).description),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) return setError('请填写项目名称。')
    mutation.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>创建项目</DialogTitle>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            项目名称
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            项目说明
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
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
              {mutation.isPending ? '创建中…' : '创建项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
