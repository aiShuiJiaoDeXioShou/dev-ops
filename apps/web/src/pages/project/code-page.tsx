import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { projectQueryOptions } from '@/features/projects/public'
import { RepositoryPicker } from '@/features/code/public'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { describeRequestError } from '@/shared/api/errors'

/** 项目代码页：仓库关联与 Git 连接。 */
export function Component() {
  const { projectId = '' } = useParams()
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  if (project.isPending) return <PageSkeleton />
  if (project.isError || !project.data) {
    const described = describeRequestError(project.error)
    return (
      <div className="catalog">
        <PageError
          title="项目加载失败"
          description={described.description}
          requestId={described.requestId}
          onRetry={() => void project.refetch()}
        />
      </div>
    )
  }
  return (
    <div className="catalog">
      <RepositoryPicker
        projectId={projectId}
        teamId={project.data.data.teamId}
        canManage={role === 'admin' || role === 'developer'}
      />
    </div>
  )
}

export default Component
