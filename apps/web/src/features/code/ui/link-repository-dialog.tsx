import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { GitRepositorySelect } from './git-repository-select'
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
import {
  availableRepositoriesQueryOptions,
  gitConnectionsQueryOptions,
  projectRepositoriesQueryOptions,
} from '../api/queries'

/**
 * 从团队已同步仓库中为项目关联一个仓库；关联成功后关闭并刷新仓库列表。
 * @param props 团队和项目标识及受控弹窗状态。
 * @returns 带搜索的组合框和关联按钮的二级弹窗。
 */
export function LinkRepositoryDialog({
  projectId,
  teamId,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  projectId: string
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const available = useQuery({ ...availableRepositoriesQueryOptions(projectId), enabled: open })
  const connections = useQuery({ ...gitConnectionsQueryOptions(teamId), enabled: open && Boolean(teamId) })
  const linked = useQuery({ ...projectRepositoriesQueryOptions(projectId), enabled: open })
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
        queryClient.invalidateQueries({ queryKey: projectRepositoriesQueryOptions(projectId).queryKey }),
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
  const linkedIds = new Set(linked.data?.data.map((repository) => repository.id))
  const repositories = (available.data ?? []).filter((repository) => !linkedIds.has(repository.id))
  const loadError = available.error ?? connections.error ?? linked.error
  const isPending = available.isPending || linked.isPending || (Boolean(teamId) && connections.isPending)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="link-repository-dialog" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>添加项目仓库</DialogTitle>
          <DialogDescription>选择已授权的 GitHub 或 Gitea 仓库。</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <DelayedLoading pending>
            <PageLoading message="可用仓库加载中…" />
          </DelayedLoading>
        ) : loadError ? (
          <PageError
            title="可用仓库加载失败"
            description={describeRequestError(loadError).description}
            requestId={describeRequestError(loadError).requestId}
            retrying={available.isFetching || connections.isFetching || linked.isFetching}
            onRetry={() => void Promise.all([available.refetch(), connections.refetch(), linked.refetch()])}
          />
        ) : repositories.length === 0 ? (
          <p className="section-note">
            {linkedIds.size && available.data?.length
              ? '已关联所有可用仓库。可以在「团队管理 → 连接与节点」授权更多仓库。'
              : '团队还没有已同步的可用仓库。请让团队管理员在「团队管理 → 连接与节点」添加 GitHub 或 Gitea 连接。'}
          </p>
        ) : (
          <GitRepositorySelect
            repositories={repositories}
            connections={connections.data?.data ?? []}
            value={repositoryId}
            onValueChange={setRepositoryId}
            label="选择仓库"
            disabled={link.isPending}
          />
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
            disabled={
              Boolean(loadError) ||
              isPending ||
              link.isPending ||
              !repositories.some((repository) => repository.id === repositoryId)
            }
            onClick={() => link.mutate()}
          >
            {link.isPending ? '添加中…' : '添加仓库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
