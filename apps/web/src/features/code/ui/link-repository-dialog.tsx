import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Combobox } from '@/shared/ui/controls/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { availableRepositoriesQueryOptions } from '../api/queries'

/**
 * 从团队已同步仓库中为项目关联一个仓库；关联成功后关闭并刷新仓库列表。
 * @param props.projectId 项目标识；open 弹窗状态；onOpenChange 关闭回调。
 * @returns 带搜索的组合框和关联按钮的二级弹窗。
 */
export function LinkRepositoryDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const available = useQuery({ ...availableRepositoriesQueryOptions(projectId), enabled: open })
  const [repositoryId, setRepositoryId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setRepositoryId('')
    setError('')
  }, [open])
  const link = useMutation({
    mutationFn: () => apiClient.linkRepository(projectId, { repositoryId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['code', 'project-repositories', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['code', 'available-repositories', projectId] }),
      ])
      showToast('仓库已关联。', 'success')
      onOpenChange(false)
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      setError(message)
      showToast(message, 'error')
    },
  })
  const repositories = available.data ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="link-repository-dialog">
        <DialogHeader>
          <DialogTitle>关联仓库</DialogTitle>
          <DialogDescription>从团队已同步的仓库中选择；一个项目可以关联多个仓库，可重复添加。</DialogDescription>
        </DialogHeader>
        {available.isPending ? (
          <DelayedLoading pending>
            <PageLoading message="可用仓库加载中…" />
          </DelayedLoading>
        ) : available.isError ? (
          <PageError
            title="可用仓库加载失败"
            description={describeRequestError(available.error).description}
            requestId={describeRequestError(available.error).requestId}
            retrying={available.isFetching}
            onRetry={() => void available.refetch()}
          />
        ) : repositories.length === 0 ? (
          <p className="section-note">
            团队还没有已同步的可用仓库。请让团队管理员在「团队设置 → 连接与节点」中添加并同步 Git 连接。
          </p>
        ) : (
          <label className="block space-y-1.5 text-sm font-medium">
            仓库
            <Combobox
              value={repositoryId}
              onValueChange={setRepositoryId}
              options={repositories.map((repository) => ({
                value: repository.id,
                label: `${repository.namespace}/${repository.name}`,
              }))}
              placeholder="选择仓库"
              searchPlaceholder="搜索仓库"
              emptyMessage="没有匹配的仓库"
              aria-label="选择仓库"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={link.isPending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!repositoryId || link.isPending || repositories.length === 0}
            onClick={() => link.mutate()}
          >
            {link.isPending ? '关联中…' : '关联仓库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
