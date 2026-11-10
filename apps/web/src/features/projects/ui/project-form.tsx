import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useTeamRepositories } from '@/features/code/public'
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
import { Combobox } from '@/shared/ui/controls/combobox'
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
  const [repositoryId, setRepositoryId] = useState('')
  const [error, setError] = useState('')
  const teamRepositories = useTeamRepositories(teamId, open)
  const mutation = useMutation({
    mutationFn: async () => {
      const created = await apiClient.createProject(
        teamId,
        { name: name.trim(), description: description.trim() || null },
        { idempotencyKey: createIdempotencyKey() },
      )
      if (!repositoryId) return { project: created.data, linkError: null }
      try {
        await apiClient.linkRepository(created.data.id, { repositoryId })
        return { project: created.data, linkError: null }
      } catch (cause) {
        return { project: created.data, linkError: describeRequestError(cause).description }
      }
    },
    onSuccess: async (result) => {
      const linked = Boolean(repositoryId)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (linked) await queryClient.invalidateQueries({ queryKey: ['code', 'project-repositories', result.project.id] })
      setName('')
      setDescription('')
      setRepositoryId('')
      setError('')
      if (result.linkError) showToast(`项目已创建，但仓库关联失败：${result.linkError}`, 'error')
      else showToast(linked ? '项目已创建并关联仓库' : '项目已创建', 'success')
      onOpenChange(false)
      onCreated?.(result.project.id)
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
  const repositoryOptions = [
    { value: '', label: '暂不关联仓库' },
    ...teamRepositories.repositories.map((repository) => ({
      value: repository.id,
      label: `${repository.namespace}/${repository.name}`,
    })),
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>创建项目</DialogTitle>
          <DialogDescription>创建项目并关联团队已同步的 Git 仓库。</DialogDescription>
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
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">关联仓库（可选）</span>
            <Combobox
              value={repositoryId}
              onValueChange={setRepositoryId}
              options={repositoryOptions}
              placeholder="暂不关联仓库"
              searchPlaceholder="搜索仓库"
              emptyMessage="没有匹配的仓库"
              disabled={teamRepositories.isLoading}
              aria-label="关联仓库（可选）"
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {teamRepositories.repositories.length === 0
              ? '当前团队还没有已同步的仓库。可以先创建项目，再到代码页添加 Git 连接。'
              : '项目创建后会立即关联所选仓库；也可以稍后到代码页调整。'}
          </p>
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
              {mutation.isPending ? '创建中…' : repositoryId ? '创建并关联' : '创建项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
