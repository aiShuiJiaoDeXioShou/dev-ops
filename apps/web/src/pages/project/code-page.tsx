import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Code2 } from 'lucide-react'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { useSession } from '@/features/identity/public'
import { projectQueryOptions } from '@/features/projects/public'
import { projectRepositoriesQueryOptions, RepositoryPicker } from '@/features/code/public'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { describeRequestError } from '@/shared/api/errors'

/**
 * 项目代码页：已关联仓库时展示仓库概览和代码浏览状态；未关联时进入仓库管理。
 * @returns 代码页内容。
 */
export function Component() {
  const { projectId = '' } = useParams()
  const { role } = useSession()
  const project = useQuery(projectQueryOptions(projectId))
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const canManage = role === 'admin' || role === 'developer'
  if (project.isPending || repositories.isPending) return <PageSkeleton />
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
  const linkedRepositories = repositories.data?.data ?? []
  if (linkedRepositories.length === 0) {
    return (
      <div className="catalog">
        <RepositoryPicker projectId={projectId} teamId={project.data.data.teamId} canManage={canManage} />
      </div>
    )
  }
  return (
    <div className="catalog code-overview-page">
      <section className="card">
        <div className="section-heading">
          <h2>已关联仓库</h2>
          <span className="spacer" />
          <Tag>{linkedRepositories.length} 个</Tag>
        </div>
        <div className="repo-list">
          {linkedRepositories.map((repo) => (
            <div className="repo-row" key={repo.id}>
              <div>
                <a className="repo-name" href={repo.webUrl} target="_blank" rel="noreferrer">
                  {repo.namespace}/{repo.name}
                </a>
                <p className="small quiet">默认分支 · {repo.defaultBranch}</p>
              </div>
              <span className="spacer" />
              <Tag variant={repo.status === 'available' ? 'green' : 'red'}>{repo.status}</Tag>
              <a className="btn" href={repo.webUrl} target="_blank" rel="noreferrer">
                <PrototypeIcon name="external" />
                在远端打开
              </a>
            </div>
          ))}
        </div>
      </section>
      <section className="card code-browser-placeholder">
        <EmptyState
          icon={<Code2 />}
          title="代码浏览尚未接入"
          description="当前版本只保存仓库关联并展示代码引用，还不会读取远端仓库的文件树和文件内容。仓库管理仍可在下方展开调整。"
        />
      </section>
      <details className="connection-form code-settings-details">
        <summary>管理仓库关联与 Git 连接</summary>
        <RepositoryPicker projectId={projectId} teamId={project.data.data.teamId} canManage={canManage} />
      </details>
    </div>
  )
}

export default Component
