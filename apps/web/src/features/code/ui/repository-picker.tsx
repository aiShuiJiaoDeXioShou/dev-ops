import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { projectRepositoriesQueryOptions } from '../api/queries'

/**
 * 项目已关联仓库列表：查看来源状态并解除关联。
 * 添加仓库由代码仓库区域的“关联仓库”二级弹窗负责。
 * @param props.projectId 项目标识；canManage 当前用户是否允许解除关联。
 * @returns 已关联仓库卡片与解除确认弹窗。
 */
export function RepositoryPicker({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const projectRepos = useQuery(projectRepositoriesQueryOptions(projectId))
  const [unlinkTarget, setUnlinkTarget] = useState<{ id: string; name: string } | null>(null)
  const [unlinkReason, setUnlinkReason] = useState('')
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['code', 'project-repositories', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['code', 'available-repositories', projectId] }),
    ])
  }
  const unlink = useMutation({
    mutationFn: async () => {
      if (!unlinkTarget) throw new Error('缺少解除目标')
      return apiClient.unlinkRepository(projectId, unlinkTarget.id, { reason: unlinkReason.trim() })
    },
    onSuccess: async () => {
      setUnlinkTarget(null)
      setUnlinkReason('')
      await invalidate()
      showToast('仓库关联已解除。', 'success')
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      showToast(message, 'error')
    },
  })
  const repositories = projectRepos.data?.data ?? []
  return (
    <div className="repo-settings">
      <section className="card">
        <div className="section-heading">
          <h3>已关联仓库</h3>
          <span className="spacer" />
          <span className="small quiet">{repositories.length} 个已关联</span>
        </div>
        {projectRepos.isPending ? (
          <DelayedLoading pending>
            <PageLoading message="仓库加载中…" />
          </DelayedLoading>
        ) : projectRepos.isError ? (
          <PageError
            title="已关联仓库加载失败"
            description={describeRequestError(projectRepos.error).description}
            requestId={describeRequestError(projectRepos.error).requestId}
            retrying={projectRepos.isFetching}
            onRetry={() => void projectRepos.refetch()}
          />
        ) : repositories.length === 0 ? (
          <p className="section-note">还没有关联仓库。使用上方「关联仓库」按钮添加。</p>
        ) : (
          <div className="repo-list">
            {repositories.map((repository) => (
              <div className="repo-row" key={repository.id}>
                <div>
                  <a className="repo-name" href={repository.webUrl} target="_blank" rel="noreferrer">
                    {repository.namespace}/{repository.name}
                  </a>
                  <p className="small quiet">项目仓库 · {repository.defaultBranch ?? '未知分支'}</p>
                </div>
                <span className="spacer" />
                <Tag variant={repository.status === 'available' ? 'green' : 'red'}>{repository.status}</Tag>
                {canManage && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUnlinkTarget({ id: repository.id, name: `${repository.namespace}/${repository.name}` })
                      setUnlinkReason('')
                    }}
                  >
                    解除关联
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUnlinkTarget(null)
            setUnlinkReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>解除仓库关联</DialogTitle>
            <DialogDescription>
              解除后该仓库仍保留在团队 Git 连接中，但本项目将无法再从代码页和 PR 页读取它；历史活动与代码引用保留。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!unlinkReason.trim()) return
              unlink.mutate()
            }}
          >
            <label className="block space-y-1.5 text-sm font-medium">
              解除原因
              <Input
                value={unlinkReason}
                maxLength={2000}
                readOnly={unlink.isPending}
                placeholder={`说明解除 ${unlinkTarget?.name ?? ''} 关联的原因`}
                onChange={(event) => setUnlinkReason(event.target.value)}
              />
            </label>
            {unlink.isError && (
              <p role="alert" className="field-error">
                {describeRequestError(unlink.error).description}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={unlink.isPending} onClick={() => setUnlinkTarget(null)}>
                取消
              </Button>
              <Button type="submit" variant="destructive" disabled={!unlinkReason.trim() || unlink.isPending}>
                {unlink.isPending ? '解除中…' : '确认解除'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
