import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { RepositoryPicker } from '@/features/code/public'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
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
  const canManage = role === 'admin' || role === 'developer'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>项目设置</DialogTitle>
          <DialogDescription>修改项目资料、负责人和状态，并管理代码仓库与 Git 连接。</DialogDescription>
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
              <h3 className="settings-section-title">代码仓库</h3>
              <RepositoryPicker projectId={projectId} teamId={project.data.data.teamId} canManage={canManage} />
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
