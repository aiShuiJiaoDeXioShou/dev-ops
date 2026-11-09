import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { projectQueryOptions } from '@/features/projects/public'
import { RepositoryPicker } from '@/features/code/public'
import { ProjectSettingsForm } from '@/features/projects/public'
import { PageLoading } from '@/shared/ui/page-state'

/** 项目设置：Git 连接与仓库关联。 */
export function Component() {
  const { projectId = '' } = useParams()
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  if (project.isPending) return <PageLoading />
  if (!project.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        项目加载失败。
      </p>
    )
  const canManage = role === 'admin' || role === 'developer'
  return (
    <div className="space-y-6">
      {canManage && <ProjectSettingsForm project={project.data.data} />}
      <RepositoryPicker projectId={projectId} teamId={project.data.data.teamId} canManage={canManage} />
    </div>
  )
}

export default Component
