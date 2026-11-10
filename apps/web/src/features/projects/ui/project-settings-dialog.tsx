import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { LinkRepositoryDialog, RepositoryPicker } from '@/features/code/public'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Button } from '@/shared/ui/controls/button'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { projectQueryOptions } from '../api/queries'
import { ProjectSettingsForm } from './project-settings-form'
import { ServiceManagement } from './service-management'

/**
 * 项目设置弹窗；项目头部齿轮入口使用，不再跳转独立页面。
 * @param props.projectId 项目标识；open 打开状态；onOpenChange 关闭回调。
 * @returns 项目资料表单弹窗；只读角色仅能查看。
 */
export function ProjectSettingsDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  const [linkOpen, setLinkOpen] = useState(false)
  const canManage = role === 'admin' || role === 'developer'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(640px,calc(100vw-32px))]"
        onOpenAutoFocus={(event) => {
          // 不把初始焦点放进名称输入框，避免打开设置时浏览器全选已有文本。
          event.preventDefault()
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>项目设置</DialogTitle>
          <DialogDescription>修改项目资料、负责人和状态，并管理项目仓库与服务。</DialogDescription>
        </DialogHeader>
        {project.isPending ? (
          <DelayedLoading pending>
            <PageSkeleton />
          </DelayedLoading>
        ) : project.isError || !project.data ? (
          <div className="empty">
            <h3>项目设置加载失败</h3>
            <button type="button" className="btn" onClick={() => void project.refetch()}>
              重新加载
            </button>
          </div>
        ) : (
          <div className="project-settings-sections">
            <ProjectSettingsForm
              project={project.data.data}
              readOnly={!canManage}
              onCancel={() => onOpenChange(false)}
              onSaved={() => onOpenChange(false)}
            />
            <section>
              <div className="settings-divider" />
              <div className="settings-section-head">
                <h3 className="settings-section-title">代码仓库</h3>
                {canManage && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                    关联仓库
                  </Button>
                )}
              </div>
              <p className="section-note">一个项目可以关联多个仓库；代码页和 PR 页可在仓库间切换。</p>
              <RepositoryPicker projectId={projectId} canManage={canManage} />
              <LinkRepositoryDialog projectId={projectId} open={linkOpen} onOpenChange={setLinkOpen} />
            </section>
            <section>
              <div className="settings-divider" />
              <ServiceManagement projectId={projectId} />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
