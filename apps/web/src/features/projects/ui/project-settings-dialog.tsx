import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/features/identity/model/session'
import { LinkRepositoryDialog } from '@/features/code/ui/link-repository-dialog'
import { RepositoryPicker } from '@/features/code/ui/repository-picker'
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
import { FormSectionSkeleton } from '@/shared/ui/page-skeleton'
import { projectQueryOptions } from '../api/queries'
import { ProjectLifecycleAction } from './project-lifecycle-action'
import { ProjectSettingsForm } from './project-settings-form'
import { ProjectWorkItemTemplates } from './project-work-item-templates'
import { ServiceManagement } from './service-management'
import { PageError } from '@/shared/ui/page-state'

/**
 * 项目设置弹窗；项目头部齿轮入口使用，不再跳转独立页面。
 * @param props.projectId 项目标识；open 打开状态；onOpenChange 关闭回调；onRemoved 删除成功后处理列表或导航。
 * @returns 项目资料表单弹窗；只读角色仅能查看。
 */
export function ProjectSettingsDialog({
  projectId,
  open,
  onOpenChange,
  onRemoved,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoved: () => void
}) {
  const { role, currentTeam, user, teams } = useSession()
  const client = useQueryClient()
  const project = useQuery(projectQueryOptions(projectId))
  const addRepositoryTrigger = useRef<HTMLButtonElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const canManage = role === 'admin' || role === 'developer'
  const projectTeamRole = teams.find((team) => team.id === project.data?.data.teamId)?.role
  const canRemove =
    projectTeamRole === 'admin' || (projectTeamRole === 'developer' && project.data?.data.owner.userId === user.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        layout="form"
        className="dialog-w-lg"
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
          <DialogDescription>维护项目资料、代码仓库、项目服务和事项流程模板。</DialogDescription>
        </DialogFormHeader>
        {project.isPending ? (
          <DialogFormBody>
            <FormSectionSkeleton fields={4} label="项目设置加载中" />
          </DialogFormBody>
        ) : !project.data ? (
          <DialogFormBody>
            <PageError
              title="项目设置加载失败"
              error={project.error}
              retrying={project.isFetching}
              retryLabel="重新加载"
              onRetry={() => void project.refetch()}
            />
          </DialogFormBody>
        ) : (
          <Tabs defaultValue="profile" className="project-settings-tabs flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-4 sm:px-6">
              <TabsList aria-label="项目设置分组">
                <TabsTrigger value="profile">基本资料</TabsTrigger>
                <TabsTrigger value="repositories">代码仓库</TabsTrigger>
                <TabsTrigger value="services">项目服务</TabsTrigger>
                <TabsTrigger value="work-item-templates">流程模板</TabsTrigger>
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
                {canRemove && (
                  <div className="mt-6 border-t pt-4">
                    <ProjectLifecycleAction
                      project={project.data.data}
                      action="remove"
                      onDone={() => {
                        onOpenChange(false)
                        onRemoved()
                        void client.invalidateQueries({ queryKey: ['projects'] })
                        void client.invalidateQueries({ queryKey: ['operations'] })
                      }}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="repositories">
                <div className="settings-section-head">
                  <h3 className="settings-section-title">代码仓库</h3>
                  {canManage && (
                    <Button
                      ref={addRepositoryTrigger}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLinkOpen(true)}
                    >
                      添加仓库
                    </Button>
                  )}
                </div>
                <p className="section-note">一个项目可以关联多个仓库；代码页和 PR 页可在仓库间切换。</p>
                <RepositoryPicker projectId={projectId} canManage={canManage} />
                <LinkRepositoryDialog
                  teamId={currentTeam?.id ?? ''}
                  projectId={projectId}
                  open={linkOpen}
                  onOpenChange={setLinkOpen}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    addRepositoryTrigger.current?.focus()
                  }}
                />
              </TabsContent>
              <TabsContent value="services">
                <ServiceManagement projectId={projectId} />
              </TabsContent>
              <TabsContent value="work-item-templates">
                <ProjectWorkItemTemplates project={project.data.data} readOnly={!canManage} />
              </TabsContent>
            </DialogFormBody>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
