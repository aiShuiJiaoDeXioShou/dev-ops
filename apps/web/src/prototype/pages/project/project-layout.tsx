import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoStatus } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import { demoMembers } from '@/prototype/data/seed'
import type { DemoProject } from '@/prototype/data/types'

const projectTabs = [
  { slug: 'requirements', label: '需求' },
  { slug: 'collaboration', label: '协作' },
  { slug: 'code', label: '代码' },
  { slug: 'bugs', label: 'Bug' },
  { slug: 'prs', label: 'PR' },
  { slug: 'pipelines', label: '流水线' },
  { slug: 'artifacts', label: '产物与版本' },
  { slug: 'environment', label: '环境变量' },
]

/**
 * 解析当前项目页签，用于切换项目后保持位置。
 * @param pathname 浏览器路径。
 * @returns 页签 slug，默认需求。
 */
function tabFromPath(pathname: string) {
  const slug = pathname.split('/').filter(Boolean).at(-1) ?? ''
  return projectTabs.some((tab) => tab.slug === slug) ? slug : 'requirements'
}

/**
 * 渲染与 HTML 原型一致的项目工作区头部、页签与设置入口。
 * @returns 项目布局；项目不存在时提供返回项目列表的恢复入口。
 */
export function ProjectLayout() {
  const { projectId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { openMenu } = usePrototypeMenu()
  const { currentTeam, teamProjects, currentProject, setCurrentProject, currentRole, showToast } = usePrototype()
  const project = teamProjects.find((item) => item.id === projectId)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (project && currentProject.id !== project.id) setCurrentProject(project.id)
  }, [project, currentProject.id, setCurrentProject])

  if (!project) {
    return (
      <div className="empty">
        <PrototypeIcon name="folder" />
        <h3>项目不存在</h3>
        <p>该项目不属于当前团队，或已在原型数据中被移除。</p>
        <button type="button" className="btn" onClick={() => navigate('/prototype/projects')}>
          返回项目列表
        </button>
      </div>
    )
  }

  const activeTab = tabFromPath(location.pathname)
  const activeTabLabel = projectTabs.find((tab) => tab.slug === activeTab)?.label ?? '需求'

  return (
    <>
      <header className="project-header">
        <div className="breadcrumb">
          <button type="button" className="icon-btn mobile-menu" aria-label="展开导航" onClick={openMenu}>
            <PrototypeIcon name="menu" />
          </button>
          <button type="button" className="muted" onClick={() => navigate('/prototype/projects')}>
            项目
          </button>
          <span>/</span>
          <span>{project.repo}</span>
        </div>
        <div className="row spread">
          <div className="project-title">
            <PrototypeIcon name="repo" />
            <select
              className="project-select"
              aria-label="当前项目"
              value={project.id}
              onChange={(event) => {
                setCurrentProject(event.target.value)
                navigate(`/prototype/project/${event.target.value}/${activeTab}`)
              }}
            >
              {teamProjects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="badge">{project.visibility}</span>
          </div>
          <div className="row header-actions">
            <button
              type="button"
              className="btn external"
              onClick={() => showToast(`原型未连接 ${project.provider}，请在正式实现中查看远端仓库。`)}
            >
              在 {project.provider} 查看 <PrototypeIcon name="external" />
            </button>
            <button type="button" className="icon-btn" aria-label="项目设置" onClick={() => setSettingsOpen(true)}>
              <PrototypeIcon name="settings" />
            </button>
            {['requirements', 'bugs'].includes(activeTab) && (
              <button
                type="button"
                className="btn primary"
                disabled={currentRole === '浏览者'}
                onClick={() => window.dispatchEvent(new CustomEvent('prototype:new-item'))}
              >
                <PrototypeIcon name="plus" />
                新建{activeTabLabel}
              </button>
            )}
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="项目功能">
          {projectTabs.map((tab) => (
            <button
              key={tab.slug}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.slug}
              className="tab"
              onClick={() => navigate(`/prototype/project/${project.id}/${tab.slug}`)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>
      <div className={activeTab === 'collaboration' ? 'content bot-content' : 'content'}>
        <Outlet />
      </div>
      <ProjectSettingsDialog
        key={project.id}
        project={project}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <span className="sr-only">
        当前团队：{currentTeam.name}；项目状态：{project.status}
      </span>
    </>
  )
}

/**
 * 渲染项目设置对话框，保持原型的表单结构与状态选项。
 * @param props.project 当前项目；props.open 打开状态；props.onClose 关闭回调。
 * @returns 原生 dialog 设置表单；只修改本地演示数据。
 */
function ProjectSettingsDialog({
  project,
  open,
  onClose,
}: {
  project: DemoProject
  open: boolean
  onClose: () => void
}) {
  const { currentRole, updateProject, showToast } = usePrototype()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [owner, setOwner] = useState(project.owner)
  const [status, setStatus] = useState<DemoProject['status']>(project.status)
  const [repo, setRepo] = useState(project.repo === '尚未关联仓库' ? '' : project.repo)
  const [provider, setProvider] = useState<DemoProject['provider']>(project.provider)
  const readOnly = currentRole === '浏览者'

  const save = () => {
    if (!name.trim()) {
      showToast('项目名称不能为空')
      return
    }
    updateProject(project.id, {
      name: name.trim(),
      description: description.trim(),
      owner,
      status,
      provider,
      repo: repo.trim() || '尚未关联仓库',
    })
    showToast('项目设置已保存（本地演示）')
    onClose()
  }

  return (
    <PrototypeDialog open={open} title="项目设置" onClose={onClose}>
      <div className="form-grid">
        <label className="field full">
          项目名称
          <input value={name} maxLength={50} disabled={readOnly} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          项目状态
          <select
            value={status}
            disabled={readOnly}
            onChange={(event) => setStatus(event.target.value as DemoProject['status'])}
          >
            <option value="进行中">进行中</option>
            <option value="暂停">暂停</option>
            <option value="已结束">已结束</option>
          </select>
        </label>
        <label className="field">
          负责人
          <select value={owner} disabled={readOnly} onChange={(event) => setOwner(event.target.value)}>
            {demoMembers.map((member) => (
              <option key={member}>{member}</option>
            ))}
          </select>
        </label>
        <label className="field full">
          项目说明
          <textarea
            value={description}
            maxLength={500}
            disabled={readOnly}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="field">
          代码平台
          <select
            value={provider}
            disabled={readOnly}
            onChange={(event) => setProvider(event.target.value as DemoProject['provider'])}
          >
            <option>GitHub</option>
            <option>Gitea</option>
          </select>
        </label>
        <label className="field">
          关联仓库（可选）
          <input
            value={repo}
            placeholder="owner/repository"
            maxLength={100}
            disabled={readOnly}
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
      </div>
      <div className="settings-row">
        <div>
          <strong>关联仓库</strong>
          <p>
            {provider} · {repo.trim() || '尚未关联仓库'}（V0.1 原型只保存关联关系，不读取真实仓库）
          </p>
        </div>
        <span className="badge">{repo.trim() ? '已关联' : '未关联'}</span>
      </div>
      <div className="settings-row">
        <div>
          <strong>项目状态</strong>
          <p>
            <ProtoStatus status={status} />
          </p>
        </div>
        <span className="small quiet">PR 合并和需求通过不会自动修改状态</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn primary" disabled={readOnly} onClick={save}>
          保存
        </button>
      </div>
    </PrototypeDialog>
  )
}
