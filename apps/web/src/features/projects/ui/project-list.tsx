import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Folder, Plus, Search, Settings, Users } from 'lucide-react'
import { useSession } from '@/features/identity/model/session'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { projectActivityQueryOptions, projectListQueryOptions } from '../api/queries'
import {
  countProjectCriteria,
  parseProjectFilters,
  PROJECT_STATUS_LABELS,
  projectFilterParams,
  toProjectQueryFilters,
  updateProjectFilters,
} from '../model/filters'
import { ProjectFilter } from './project-filter'
import { ProjectForm } from './project-form'
import { ProjectRecycleBin } from './project-recycle-bin'
import { ProjectSettingsDialog } from './project-settings-dialog'
import { ActivityBarometer } from './activity-barometer'

/**
 * 显示团队项目列表和晴雨表，搜索及组合筛选同步写入 URL。
 * @returns 项目卡片、筛选工具栏及创建与设置入口。
 */
export function ProjectList() {
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const { currentTeam, role, user } = useSession()
  const [params, setParams] = useSearchParams()
  const filters = parseProjectFilters(params)
  const queryFilters = toProjectQueryFilters(filters)
  const { status, repository, ownerId, ownerUnavailable } = filters
  const criteria = { status, repository, ownerId, ownerUnavailable }
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)
  const [activitySource, setActivitySource] = useState<'all' | 'activity' | 'code' | 'pull_request'>('all')
  const [searchInput, setSearchInput] = useState(filters.search)
  const query = useQuery(
    projectListQueryOptions(currentTeam?.id ?? '', {
      ...queryFilters,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
  )
  const activity = useQuery(
    projectActivityQueryOptions(currentTeam?.id ?? '', {
      ...queryFilters,
      source: activitySource,
    }),
  )
  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])
  useEffect(() => {
    if (searchInput === filters.search) return
    // 搜索输入防抖后再改 URL 和查询条件，避免逐字触发项目列表与晴雨表请求。
    const timer = window.setTimeout(() => {
      const next = updateProjectFilters(parseProjectFilters(params), { search: searchInput })
      setParams(projectFilterParams(next))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput, filters.search, params, setParams])
  const activityByProject = new Map((activity.data?.data.projects ?? []).map((summary) => [summary.projectId, summary]))
  const update = (patch: Parameters<typeof updateProjectFilters>[1]) =>
    setParams(projectFilterParams(updateProjectFilters(filters, patch)))
  if (!currentTeam)
    return (
      <div className="catalog empty-page">
        <h1 className="sr-only">项目</h1>
        <EmptyState
          mascot="project"
          title="还没有加入团队"
          description="团队空间会承载项目、需求、Bug 和成员协作。请让平台管理员邀请你加入，或前往团队管理创建第一个团队。"
          action={
            <Button asChild>
              <Link to="/settings/team">
                <Users className="size-4" aria-hidden="true" />
                团队管理
              </Link>
            </Button>
          }
        />
      </div>
    )
  if (query.isPending) return <DelayedPageSkeleton />
  if (query.isError && !query.data) {
    return (
      <PageError
        title="项目列表加载失败"
        error={query.error}
        retrying={query.isFetching}
        retryLabel="重新加载"
        onRetry={() => void query.refetch()}
      />
    )
  }
  const projects = query.data.data.items
  const hasFilters = Boolean(filters.search || countProjectCriteria(criteria))
  return (
    <>
      <header className="page-head">
        <div className="row">
          <h1 ref={heading} tabIndex={-1}>
            项目
          </h1>
          <span className="spacer" />
          {role === 'admin' && <ProjectRecycleBin key={currentTeam.id} teamId={currentTeam.id} />}
          <Button type="button" disabled={role === 'viewer'} onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            创建项目
          </Button>
        </div>
      </header>
      <div className="catalog project-home">
        <ActivityBarometer
          result={activity.data?.data}
          isPending={activity.isPending}
          isError={activity.isError}
          error={activity.error}
          isFetching={activity.isFetching}
          onRetry={() => void activity.refetch()}
          source={activitySource}
          onSourceChange={setActivitySource}
        />
        <div className="filters">
          <ProjectFilter teamId={currentTeam.id} currentUserId={user.id} value={criteria} onApply={update} />
          <label className="search">
            <Search className="size-4" aria-hidden="true" />
            <Input
              className="search-input"
              aria-label="搜索项目"
              placeholder="搜索项目名称或说明"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
        </div>
        {projects.length === 0 ? (
          <EmptyState
            mascot="project"
            title={hasFilters ? '没有匹配的项目' : '还没有项目'}
            description={
              hasFilters
                ? '可以调整筛选条件，或清除筛选后查看全部项目。'
                : '创建第一个项目，把需求、Bug、代码引用和团队协作放在同一个工作区。'
            }
            action={
              hasFilters ? (
                <Button type="button" variant="outline" onClick={() => setParams(new URLSearchParams())}>
                  清除筛选
                </Button>
              ) : role !== 'viewer' ? (
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  创建项目
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <article
                key={project.id}
                className="project-card clickable-card"
                onClick={(event) => {
                  if (isNestedInteractiveTarget(event.target)) return
                  navigate(`/projects/${project.id}/requirements`)
                }}
              >
                <div className="project-card-head">
                  <span className="project-symbol">
                    <Folder className="size-4" aria-hidden="true" />
                  </span>
                  <div className="project-identity">
                    <Link className="project-card-title" to={`/projects/${project.id}/requirements`}>
                      {project.name}
                    </Link>
                    {project.description && <p className="repo-caption">{project.description}</p>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="project-settings-button"
                    aria-label={`${project.name}项目设置`}
                    onClick={() => setSettingsProjectId(project.id)}
                  >
                    <Settings className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="project-state-row">
                  <span className="status">
                    <span
                      className={`dot ${project.status === 'active' ? 'green' : project.status === 'paused' ? 'amber' : ''}`}
                    />
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                  <span className="project-owner">
                    <UserAvatar name={project.owner.name} image={project.owner.image} className="size-5" />
                    <span className="project-owner-name" title={project.owner.name}>
                      {project.owner.name}
                    </span>
                  </span>
                </div>
                {(() => {
                  const summary = activityByProject.get(project.id)
                  const done = summary?.items.completed ?? 0
                  const total = summary?.items.total ?? 0
                  const percent = total > 0 ? Math.round((done / total) * 100) : 0
                  const pendingPr = summary ? (summary.pendingPullRequests ?? '—') : '—'
                  return (
                    <>
                      <div className="project-metrics">
                        <Link to={`/projects/${project.id}/requirements`}>
                          <strong>{summary?.pendingRequirements ?? project.counts.openRequirements}</strong>
                          <span>待处理需求</span>
                        </Link>
                        <Link to={`/projects/${project.id}/bugs`}>
                          <strong>{summary?.pendingBugs ?? project.counts.openBugs}</strong>
                          <span>待处理 Bug</span>
                        </Link>
                        <Link to={`/projects/${project.id}/prs`}>
                          <strong>{pendingPr}</strong>
                          <span>待审 PR</span>
                        </Link>
                      </div>
                      <div className="project-progress progress-caption project-progress-inline">
                        <span>
                          完成度 <b>{percent}%</b>
                        </span>
                        <progress max={100} value={percent} aria-label={`${project.name}事项完成度`}>
                          {percent}%
                        </progress>
                        <span>
                          {done}/{total}
                        </span>
                      </div>
                    </>
                  )
                })()}
              </article>
            ))}
          </div>
        )}
        {query.data.data.total > filters.pageSize && (
          <div className="pagination">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() => update({ page: filters.page - 1 })}
            >
              上一页
            </Button>
            <span className="quiet">第 {filters.page} 页</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filters.page * filters.pageSize >= query.data.data.total}
              onClick={() => update({ page: filters.page + 1 })}
            >
              下一页
            </Button>
          </div>
        )}
      </div>
      <ProjectForm teamId={currentTeam.id} open={createOpen} onOpenChange={setCreateOpen} />
      <ProjectSettingsDialog
        projectId={settingsProjectId ?? ''}
        open={Boolean(settingsProjectId)}
        onRemoved={() => {
          if (filters.page > 1 && projects.length === 1) update({ page: filters.page - 1 })
          requestAnimationFrame(() => heading.current?.focus())
        }}
        onOpenChange={(open) => {
          if (!open) setSettingsProjectId(null)
        }}
      />
    </>
  )
}
