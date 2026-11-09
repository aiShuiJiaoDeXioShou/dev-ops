import { NavLink, Outlet, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { projectQueryOptions, projectStatsQueryOptions } from '@/features/projects/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/controls/badge'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { cn } from '@/shared/lib/utils'

const STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const
const tabs = [
  { segment: 'requirements', label: '需求' },
  { segment: 'bugs', label: 'Bug' },
  { segment: 'settings', label: '项目设置' },
]

/** 项目内布局：项目上下文、标签页与事项统计。 */
export function Component() {
  const { projectId = '' } = useParams()
  const project = useQuery(projectQueryOptions(projectId))
  const stats = useQuery(projectStatsQueryOptions(projectId))
  if (project.isPending) return <PageLoading />
  if (project.isError) {
    const described = describeRequestError(project.error)
    return (
      <PageError
        title="项目加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void project.refetch()}
      />
    )
  }
  const detail = project.data.data
  return (
    <section className="space-y-6">
      <header className="space-y-4 border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">项目</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{detail.name}</h1>
            {detail.description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail.description}</p>}
          </div>
          <Badge variant="outline">{STATUS_LABELS[detail.status]}</Badge>
        </div>
        <div className="flex flex-wrap gap-5 text-sm text-muted-foreground">
          <span>负责人 {detail.owner.name}</span>
          <span>未完成需求 {stats.data?.data.openRequirements ?? detail.counts.openRequirements}</span>
          <span>未解决 Bug {stats.data?.data.openBugs ?? detail.counts.openBugs}</span>
          <span>更新于 {formatDateTime(detail.updatedAt)}</span>
        </div>
        <nav aria-label="项目功能" className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <NavLink
              key={tab.segment}
              to={tab.segment}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </section>
  )
}

export default Component
