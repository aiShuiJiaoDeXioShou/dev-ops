import { Link, useSearchParams } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Badge } from '@/shared/ui/controls/badge'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { formatDateTime } from '@/shared/lib/format'
import { projectListQueryOptions } from '../api/queries'
import { describeRequestError } from '@/shared/api/errors'
import {
  parseProjectFilters,
  PROJECT_STATUS_LABELS,
  projectFilterParams,
  updateProjectFilters,
  type ProjectStatus,
} from '../model/filters'
import { ProjectForm } from './project-form'

/** 项目列表：筛选、分页、创建与项目入口。 */
export function ProjectList() {
  const { currentTeam, role } = useSession()
  const [params, setParams] = useSearchParams()
  const filters = parseProjectFilters(params)
  const [createOpen, setCreateOpen] = useState(false)
  const query = useQuery(
    projectListQueryOptions(currentTeam?.id ?? '', {
      search: filters.search || undefined,
      status: (filters.status || undefined) as ProjectStatus | undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
  )
  const update = (patch: Parameters<typeof updateProjectFilters>[1]) => {
    setParams(projectFilterParams(updateProjectFilters(filters, patch)))
  }
  if (!currentTeam)
    return (
      <p className="text-sm text-muted-foreground">当前账号还没有加入任何团队，请联系平台管理员创建团队并邀请你。</p>
    )
  if (query.isPending) return <PageLoading />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="项目列表加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const projects = query.data.data.items
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{currentTeam.name}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">项目</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="搜索项目"
            placeholder="搜索项目名称"
            className="w-48"
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <Select
            aria-label="项目状态"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button type="button" onClick={() => setCreateOpen(true)} disabled={role === 'viewer'}>
            创建项目
          </Button>
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {filters.search || filters.status ? '没有匹配的项目，尝试清除筛选。' : '还没有项目，创建第一个项目开始协作。'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}/requirements`}
              className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold group-hover:text-primary">{project.name}</h2>
                <Badge variant="outline">{PROJECT_STATUS_LABELS[project.status]}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                {project.description || '暂无项目说明'}
              </p>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>负责人 {project.owner.name}</span>
                <span>
                  需求 {project.counts.openRequirements} · Bug {project.counts.openBugs}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">更新于 {formatDateTime(project.updatedAt)}</p>
            </Link>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {query.data.data.total} 个项目</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => update({ page: filters.page - 1 })}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page * filters.pageSize >= query.data.data.total}
            onClick={() => update({ page: filters.page + 1 })}
          >
            下一页
          </Button>
        </div>
      </div>
      <ProjectForm teamId={currentTeam.id} open={createOpen} onOpenChange={setCreateOpen} />
    </section>
  )
}
