import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { projectRepositoriesQueryOptions, useTeamRepositories } from '@/features/code/api/queries'
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
import { GitRepositorySelect } from '@/features/code/ui/git-repository-select'
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
      if (linked) {
        await queryClient.invalidateQueries({ queryKey: projectRepositoriesQueryOptions(result.project.id).queryKey })
      }
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
          <GitRepositorySelect
            value={repositoryId}
            onValueChange={setRepositoryId}
            repositories={teamRepositories.repositories}
            connections={teamRepositories.connections}
            label="关联仓库（可选）"
            optional
            disabled={teamRepositories.isLoading || mutation.isPending}
          />
          {teamRepositories.hasError ? (
            <div className="row">
              <p role="status" className="small quiet">
                有些连接的仓库加载失败。
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void teamRepositories.retry()}>
                重试
              </Button>
            </div>
          ) : !teamRepositories.isLoading && teamRepositories.repositories.length === 0 ? (
            <p className="small quiet">请在「团队管理 → 连接与节点」添加 GitHub 或 Gitea 连接。</p>
          ) : null}
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
