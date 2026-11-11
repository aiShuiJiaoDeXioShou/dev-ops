import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { EmptyState } from '@/shared/ui/page-state'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { projectActivityQueryOptions, projectListQueryOptions } from '../api/queries'
import {
  parseProjectFilters,
  PROJECT_STATUS_LABELS,
  projectFilterParams,
  updateProjectFilters,
  type ProjectStatus,
} from '../model/filters'
import { ProjectForm } from './project-form'
import { ProjectSettingsDialog } from './project-settings-dialog'
import { ActivityBarometer } from './activity-barometer'

/** 项目列表：项目卡片、状态筛选、搜索与创建入口。 */
export function ProjectList() {
  const { currentTeam, role } = useSession()
  const [params, setParams] = useSearchParams()
  const filters = parseProjectFilters(params)
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)
  const [activitySource, setActivitySource] = useState<'all' | 'activity' | 'code' | 'pull_request'>('all')
  const [searchInput, setSearchInput] = useState(filters.search)
  const query = useQuery(
    projectListQueryOptions(currentTeam?.id ?? '', {
      search: filters.search || undefined,
      status: (filters.status || undefined) as ProjectStatus | undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
  )
  const activity = useQuery(
    projectActivityQueryOptions(currentTeam?.id ?? '', {
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.status ? { status: filters.status as ProjectStatus } : {}),
      source: activitySource,
    }),
  )
  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])
  useEffect(() => {
    if (searchInput === filters.search) return
    // 搜索输入防抖后再改 URL 和查询条件，避免逐字触发项目列表和耗时晴雨表请求。
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
            <Link className="btn primary" to="/settings/team">
              <PrototypeIcon name="users" />
              团队管理
            </Link>
          }
        />
      </div>
    )
  if (query.isPending) return <DelayedPageSkeleton />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <div className="empty">
        <PrototypeIcon name="warning" />
        <h3>项目列表加载失败</h3>
        <p>{described.description}</p>
        <button type="button" className="btn" onClick={() => void query.refetch()}>
          重新加载
        </button>
      </div>
    )
  }
  const projects = query.data.data.items
  const statusOptions = [
    { value: '', label: '全部' },
    ...Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  ]
  return (
    <>
      <header className="page-head">
        <div className="row">
          <h1>项目</h1>
          <span className="spacer" />
          <button
            type="button"
            className="btn primary"
            disabled={role === 'viewer'}
            onClick={() => setCreateOpen(true)}
          >
            <PrototypeIcon name="plus" />
            创建项目
          </button>
        </div>
      </header>
      <div className="catalog project-home">
        <ActivityBarometer
          result={activity.data?.data}
          isPending={activity.isPending}
          isError={activity.isError}
          error={activity.error}
          source={activitySource}
          onSourceChange={setActivitySource}
        />
        <div className="filters">
          <select
            className="btn project-filter"
            aria-label="项目状态"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value ? option.label : '全部状态'}
              </option>
            ))}
          </select>
          <label className="search">
            <PrototypeIcon name="search" />
            <input
              aria-label="搜索项目"
              placeholder="搜索项目、仓库或负责人"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
        </div>
        {projects.length === 0 ? (
          <EmptyState
            mascot="project"
            title={filters.search || filters.status ? '没有匹配的项目' : '还没有项目'}
            description={
              filters.search || filters.status
                ? '当前搜索或状态筛选没有找到项目，可以清除筛选后重新查看。'
                : '创建第一个项目，把需求、Bug、代码引用和团队协作放在同一个工作区。'
            }
            action={
              filters.search || filters.status ? (
                <button type="button" className="btn" onClick={() => setParams(new URLSearchParams())}>
                  清除筛选
                </button>
              ) : role !== 'viewer' ? (
                <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                  <PrototypeIcon name="plus" />
                  创建项目
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <article key={project.id} className="project-card">
                <div className="project-card-head">
                  <span className="project-symbol">
                    <PrototypeIcon name="folder" />
                  </span>
                  <div className="project-identity">
                    <Link className="project-card-title" to={`/projects/${project.id}/requirements`}>
                      {project.name}
                    </Link>
                    <p className="repo-caption">{project.description || '暂无项目说明'}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn project-settings-button"
                    aria-label={`${project.name}项目设置`}
                    onClick={() => setSettingsProjectId(project.id)}
                  >
                    <PrototypeIcon name="settings" />
                  </button>
                </div>
                <div className="project-state-row">
                  <span className="status">
                    <span
                      className={`dot ${project.status === 'active' ? 'green' : project.status === 'paused' ? 'amber' : ''}`}
                    />
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                  <span className="project-owner">
                    <span className="avatar compact">{project.owner.name.slice(0, 1)}</span>
                    {project.owner.name}
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
                      <div className="project-card-footer">
                        <div className="project-progress">
                          <div className="progress-caption">
                            <span>
                              完成度 <b>{percent}%</b>
                            </span>
                            <span>
                              {done}/{total}
                            </span>
                          </div>
                          <progress max={100} value={percent} aria-label={`${project.name}事项完成度`}>
                            {percent}%
                          </progress>
                        </div>
                        <Link className="text-btn row" to={`/projects/${project.id}/requirements`}>
                          进入项目
                          <PrototypeIcon name="arrow" />
                        </Link>
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
            <button
              type="button"
              className="btn"
              disabled={filters.page <= 1}
              onClick={() => update({ page: filters.page - 1 })}
            >
              上一页
            </button>
            <span className="quiet">第 {filters.page} 页</span>
            <button
              type="button"
              className="btn"
              disabled={filters.page * filters.pageSize >= query.data.data.total}
              onClick={() => update({ page: filters.page + 1 })}
            >
              下一页
            </button>
          </div>
        )}
      </div>
      <ProjectForm teamId={currentTeam.id} open={createOpen} onOpenChange={setCreateOpen} />
      <ProjectSettingsDialog
        projectId={settingsProjectId ?? ''}
        open={Boolean(settingsProjectId)}
        onOpenChange={(open) => {
          if (!open) setSettingsProjectId(null)
        }}
      />
    </>
  )
}
