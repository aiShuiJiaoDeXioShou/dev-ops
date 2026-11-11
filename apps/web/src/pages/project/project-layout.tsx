import { useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Settings, TriangleAlert } from 'lucide-react'
import { ProjectSettingsDialog, projectQueryOptions } from '@/features/projects/public'
import { AgentTemplateBadge } from '@/features/knowledge/public'
import { describeRequestError } from '@/shared/api/errors'
import { Tag } from '@/shared/ui/tag'
import { Button } from '@/shared/ui/controls/button'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'

const STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const
const tabs = [
  { slug: 'requirements', label: '需求' },
  { slug: 'bugs', label: 'Bug' },
  { slug: 'code', label: '代码' },
  { slug: 'prs', label: 'PR' },
  { slug: 'pipelines', label: '流水线' },
  { slug: 'artifacts', label: '产物与版本' },
  { slug: 'environment', label: '环境变量' },
]

/** 项目内布局：项目头部、页签与内容出口。 */
export function Component() {
  const { projectId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const project = useQuery(projectQueryOptions(projectId))
  if (project.isPending) return <DelayedPageSkeleton />
  if (project.isError || !project.data) {
    const described = describeRequestError(project.error)
    return (
      <div className="empty">
        <TriangleAlert className="size-5" aria-hidden="true" />
        <h3>项目加载失败</h3>
        <p>{described.description}</p>
        <Button type="button" variant="outline" onClick={() => void project.refetch()}>
          重新加载
        </Button>
      </div>
    )
  }
  const detail = project.data.data
  const activeTab = tabs.find((tab) => location.pathname.endsWith(`/${tab.slug}`))?.slug ?? 'requirements'
  return (
    <>
      <header className="project-header">
        <div className="breadcrumb">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="breadcrumb-back"
            onClick={() => navigate('/projects')}
          >
            项目
          </Button>
          <span>/</span>
          <span>{tabs.find((tab) => tab.slug === activeTab)?.label ?? '需求'}</span>
        </div>
        <div className="row spread">
          <div className="project-title">
            <FolderGit2 className="size-4" aria-hidden="true" />
            <span className="project-select-like">{detail.name}</span>
            <Tag>{STATUS_LABELS[detail.status]}</Tag>
          </div>
          <div className="row header-actions">
            <AgentTemplateBadge projectId={projectId} />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="项目设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="项目功能">
          {tabs.map((tab) => (
            <Button
              key={tab.slug}
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={activeTab === tab.slug}
              className={`tab ${activeTab === tab.slug ? 'active' : ''}`}
              onClick={() => navigate(`/projects/${projectId}/${tab.slug}`)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </header>
      <div className="content">
        <Outlet />
      </div>
      <ProjectSettingsDialog projectId={projectId} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}

export default Component
