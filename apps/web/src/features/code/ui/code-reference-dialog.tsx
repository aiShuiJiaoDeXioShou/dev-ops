import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { projectRepositoriesQueryOptions } from '../api/queries'

/**
 * 为需求或 Bug 核对、添加或替换 Commit、Issue 或 PR 引用。
 * @param props 项目、目标事项及编辑弹窗的开关与焦点回调。
 * @returns 编辑引用的局部表单，失败时保留填写内容。
 */
export function CodeReferenceDialog({
  projectId,
  targetType,
  targetId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  reference,
}: {
  projectId: string
  targetType: 'requirement' | 'bug'
  targetId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  reference?: { id: string; repositoryId: string; objectType: string; remoteId: string }
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [repositoryId, setRepositoryId] = useState('')
  const [objectType, setObjectType] = useState<'commit' | 'issue' | 'change_request'>('issue')
  const [remoteId, setRemoteId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setRepositoryId(reference?.repositoryId ?? '')
      const kind = reference?.objectType
      setObjectType(kind === 'commit' || kind === 'change_request' ? kind : 'issue')
      setRemoteId(reference?.remoteId ?? '')
      setError('')
    }
  }, [open, reference])
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createCodeReference(projectId, {
        targetType,
        targetId,
        repositoryId,
        objectType,
        remoteId: remoteId.trim(),
        ...(reference ? { replaceReferenceId: reference.id } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [targetType === 'requirement' ? 'requirements' : 'bugs', 'detail', targetId],
      })
      await queryClient.invalidateQueries({ queryKey: ['collaboration', 'activities', targetType, targetId] })
      showToast(reference ? '引用已更新。' : '引用已添加。', 'success')
      onOpenChange(false)
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? describeRequestError(cause).description : '代码引用核对失败。'
      setError(message)
      showToast(message, 'error')
    },
  })
  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{reference ? '编辑代码引用' : '添加代码引用'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium">
            仓库
            <Select
              value={repositoryId}
              disabled={repositories.isPending || mutation.isPending}
              onChange={(event) => setRepositoryId(event.target.value)}
            >
              <option value="">{repositories.isPending ? '正在加载仓库…' : '请选择项目仓库'}</option>
              {(repositories.data?.data ?? []).map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.namespace}/{repo.name}
                </option>
              ))}
            </Select>
          </label>
          {repositories.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
              仓库加载失败
              <Button type="button" size="sm" variant="outline" onClick={() => void repositories.refetch()}>
                重试
              </Button>
            </div>
          )}
          <label className="block space-y-1.5 text-sm font-medium">
            对象类型
            <Select
              value={objectType}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'commit' || value === 'issue' || value === 'change_request') setObjectType(value)
              }}
            >
              <option value="issue">Issue</option>
              <option value="change_request">Pull Request</option>
              <option value="commit">Commit</option>
            </Select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            {objectType === 'commit' ? 'Commit SHA' : '远端编号'}
            <Input value={remoteId} onChange={(event) => setRemoteId(event.target.value)} />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || !repositoryId || !remoteId.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '核对中…' : reference ? '核对并保存' : '核对并添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
