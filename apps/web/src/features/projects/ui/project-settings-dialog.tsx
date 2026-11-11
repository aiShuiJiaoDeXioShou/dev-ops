import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { LinkRepositoryDialog, RepositoryPicker } from '@/features/code/public'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
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
        layout="form"
        className="w-[min(720px,calc(100vw-32px))]"
        onOpenAutoFocus={(event) => {
          // 不把初始焦点放进名称输入框，避免打开设置时浏览器全选已有文本。
          event.preventDefault()
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.focus()
          }
        }}
      >
        <DialogFormHeader>
          <DialogTitle>项目设置</DialogTitle>
          <DialogDescription>项目资料、关联仓库与项目服务分别维护，保存只作用于当前分组。</DialogDescription>
        </DialogFormHeader>
        {project.isPending ? (
          <DialogFormBody>
            <DelayedLoading pending>
              <PageSkeleton />
            </DelayedLoading>
          </DialogFormBody>
        ) : project.isError || !project.data ? (
          <DialogFormBody>
            <div className="empty">
              <h3>项目设置加载失败</h3>
              <Button type="button" variant="outline" onClick={() => void project.refetch()}>
                重新加载
              </Button>
            </div>
          </DialogFormBody>
        ) : (
          <Tabs defaultValue="profile" className="project-settings-tabs flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-4 sm:px-6">
              <TabsList aria-label="项目设置分组">
                <TabsTrigger value="profile">基本资料</TabsTrigger>
                <TabsTrigger value="repositories">代码仓库</TabsTrigger>
                <TabsTrigger value="services">项目服务</TabsTrigger>
              </TabsList>
            </div>
            <DialogFormBody>
              <TabsContent value="profile">
                <ProjectSettingsForm
                  project={project.data.data}
                  readOnly={!canManage}
                  onCancel={() => onOpenChange(false)}
                  onSaved={() => onOpenChange(false)}
                />
              </TabsContent>
              <TabsContent value="repositories">
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
              </TabsContent>
              <TabsContent value="services">
                <ServiceManagement projectId={projectId} />
              </TabsContent>
            </DialogFormBody>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
