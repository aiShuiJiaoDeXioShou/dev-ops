import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { projectRepositoriesQueryOptions } from '../api/queries'

/** 为需求或 Bug 添加 Commit/Issue/PR 引用。 */
export function CodeReferenceDialog({
  projectId,
  targetType,
  targetId,
  open,
  onOpenChange,
}: {
  projectId: string
  targetType: 'requirement' | 'bug'
  targetId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [repositoryId, setRepositoryId] = useState('')
  const [objectType, setObjectType] = useState<'commit' | 'issue' | 'change_request'>('issue')
  const [remoteId, setRemoteId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setRepositoryId('')
      setObjectType('issue')
      setRemoteId('')
      setError('')
    }
  }, [open])
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createCodeReference(projectId, {
        targetType,
        targetId,
        repositoryId,
        objectType,
        remoteId: remoteId.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [targetType === 'requirement' ? 'requirements' : 'bugs', 'detail', targetId],
      })
      onOpenChange(false)
    },
    onError: (cause: unknown) =>
      setError(isBusinessError(cause) ? describeRequestError(cause).description : '代码引用核对失败。'),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加代码引用</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium">
            仓库
            <Select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
              <option value="">请选择项目仓库</option>
              {(repositories.data?.data ?? []).map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.namespace}/{repo.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            对象类型
            <Select value={objectType} onChange={(event) => setObjectType(event.target.value as typeof objectType)}>
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
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || !repositoryId || !remoteId.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '核对中…' : '核对并添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
