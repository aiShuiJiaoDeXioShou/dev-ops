import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoAvatar, ProtoStatus } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import { pullRequests } from '@/prototype/data/project-detail'
import { demoMembers } from '@/prototype/data/seed'
import type { DemoProject } from '@/prototype/data/types'

const projectStatuses = ['全部', '进行中', '暂停', '已结束'] as const
const activitySources = ['全部', '代码', '事项', 'PR', 'Bots'] as const
type ActivitySource = (typeof activitySources)[number]
type ProjectStatusFilter = (typeof projectStatuses)[number]

interface ActivityDay {
  date: string
  counts: Record<'代码' | '事项' | 'PR' | 'Bots', number>
  total: number
  future: boolean
  month: number
  day: number
}

/**
 * 统计项目内事项、PR 与 Bot 指标，口径与原型 projectMetrics 一致。
 * @param projectId 项目标识。
 * @param data 原型演示数据。
 * @returns 项目指标；不含远端真实数据。
 */
function projectMetrics(projectId: string, data: ReturnType<typeof usePrototype>['data']) {
  const rows = data.items.filter((row) => row.projectId === projectId)
  const done = rows.filter(
    (row) => row.status === '测试通过' || row.status === '已解决' || row.status === '已关闭',
  ).length
  return {
    total: rows.length,
    done,
    percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
    requirements: rows.filter((row) => row.kind === '需求' && row.status !== '测试通过' && row.status !== '已取消')
      .length,
    bugs: rows.filter((row) => row.kind === 'Bug' && row.status !== '已解决' && row.status !== '已关闭').length,
    prs: pullRequests.filter((pr) => pr.projectId === projectId && pr.status === '待审核').length,
    bots: 0,
  }
}

/**
 * 生成最近一年的确定性演示活动，用于复刻原型的项目晴雨表。
 * @param projects 当前可见项目。
 * @param source 活动来源筛选。
 * @returns 371 天的活动计数；相同输入得到相同结果。
 */
function activityDays(projects: DemoProject[], source: ActivitySource): ActivityDay[] {
  const now = new Date()
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7)
  return Array.from({ length: 371 }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + index)
    const date = day.toISOString().slice(0, 10)
    const counts = { 代码: 0, 事项: 0, PR: 0, Bots: 0 }
    projects.forEach((project) => {
      ;(Object.keys(counts) as Array<keyof typeof counts>).forEach((countSource) => {
        let hash = 0
        for (const char of date + project.id + countSource) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        counts[countSource] += hash % 37 < 2 ? 1 + (hash % 8) : 0
      })
    })
    const total = source === '全部' ? Object.values(counts).reduce((sum, value) => sum + value, 0) : counts[source]
    return { date, counts, total, future: day > today, month: day.getUTCMonth() + 1, day: day.getUTCDate() }
  })
}

/**
 * 渲染项目首页：活动晴雨表、项目状态筛选、项目卡片与关联项目入口。
 * @returns 与原型 projectsPage 结构和类名一致的项目列表页。
 */
export function ProjectsPage() {
  const navigate = useNavigate()
  const { openMenu } = usePrototypeMenu()
  const { data, currentTeam, currentRole, teamProjects, addProject, showToast } = usePrototype()
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('全部')
  const [query, setQuery] = useState('')
  const [activitySource, setActivitySource] = useState<ActivitySource>('全部')
  const [selectedDay, setSelectedDay] = useState<ActivityDay | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [form, setForm] = useState({ provider: 'GitHub' as DemoProject['provider'], repo: '', name: '', owner: '林然' })

  const visibleProjects = teamProjects.filter((project) => {
    const matchesStatus = statusFilter === '全部' || project.status === statusFilter
    const keyword = query.trim().toLowerCase()
    return (
      matchesStatus && (!keyword || `${project.name} ${project.repo} ${project.owner}`.toLowerCase().includes(keyword))
    )
  })
  const days = activityDays(visibleProjects, activitySource)
  const activityTotal = days.filter((day) => !day.future).reduce((sum, day) => sum + day.total, 0)
  const months = Array.from({ length: 53 }, (_, week) => {
    const first = days[week * 7]
    return first && first.day <= 7 && week < 51 ? `${first.month}月` : ''
  })

  const connect = () => {
    const repo = form.repo.trim()
    const name = form.name.trim()
    if (currentRole === '浏览者') return
    if (!name) {
      showToast('请填写项目名称')
      return
    }
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      showToast('仓库路径格式应为 owner/repository；也可以留空稍后关联')
      return
    }
    const project: DemoProject = {
      id: `project-${Date.now()}`,
      teamId: currentTeam.id,
      name,
      repo: repo || '尚未关联仓库',
      provider: form.provider,
      visibility: '私有',
      status: '进行中',
      owner: form.owner,
      description: '由原型关联流程创建的示例项目。',
      services: [],
      updatedAt: '刚刚',
    }
    addProject(project)
    setConnectOpen(false)
    showToast('已在本地建立项目关联，未创建或复制远端仓库')
    navigate(`/prototype/project/${project.id}/requirements`)
  }

  return (
    <>
      <header className="page-head">
        <div className="row">
          <button type="button" className="icon-btn mobile-menu" aria-label="展开导航" onClick={openMenu}>
            <PrototypeIcon name="menu" />
          </button>
          <h1 className="sr-only">项目</h1>
          <span className="spacer" />
          <button
            type="button"
            className="btn primary"
            disabled={currentRole === '浏览者'}
            onClick={() => setConnectOpen(true)}
          >
            <PrototypeIcon name="plus" />
            关联项目
          </button>
        </div>
      </header>
      <div className="catalog project-home">
        <section className="activity-map" aria-label="项目活动晴雨表">
          <div className="activity-heading">
            <strong>项目晴雨表</strong>
            <span className="small quiet">过去一年 · {activityTotal} 次活动</span>
            <span className="spacer" />
            <span className="small quiet">示例数据</span>
            <select
              className="btn"
              aria-label="活动来源"
              value={activitySource}
              onChange={(event) => setActivitySource(event.target.value as ActivitySource)}
            >
              {activitySources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>
          <div className="activity-scroll">
            <div className="activity-calendar">
              <div className="activity-months">
                {months.map((month, index) => (
                  <span key={index}>{month}</span>
                ))}
              </div>
              <div className="activity-weekdays" aria-hidden="true">
                <span>一</span>
                <span>三</span>
                <span>五</span>
              </div>
              <div className="activity-grid">
                {days.map((day) => {
                  if (day.future) return <span key={day.date} className="activity-day future" />
                  const level = day.total === 0 ? 0 : day.total <= 3 ? 1 : day.total <= 6 ? 2 : day.total <= 10 ? 3 : 4
                  const label = `${day.date} · ${day.total} 次活动`
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`activity-day level-${level}`}
                      title={label}
                      aria-label={label}
                      onClick={() => setSelectedDay(day)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
          <div className="activity-footer">
            <span>代码 · 事项 · PR · Bots</span>
            <div className="activity-legend" aria-label="颜色越深，活动越多">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} className={`activity-day level-${level}`} />
              ))}
              <span>多</span>
            </div>
          </div>
        </section>

        <div className="filters">
          <select
            className="btn project-filter"
            aria-label="项目状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ProjectStatusFilter)}
          >
            <option value="全部">全部状态</option>
            {projectStatuses
              .filter((item) => item !== '全部')
              .map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
          </select>
          <label className="search">
            <PrototypeIcon name="search" />
            <input
              aria-label="搜索项目"
              placeholder="搜索项目、仓库或负责人"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="project-grid">
          {visibleProjects.map((project) => {
            const metrics = projectMetrics(project.id, data)
            return (
              <article key={project.id} className="project-card">
                <div className="project-card-head">
                  <span className="project-symbol">
                    <PrototypeIcon name="folder" />
                  </span>
                  <div className="project-identity">
                    <button
                      type="button"
                      className="project-card-title"
                      onClick={() => navigate(`/prototype/project/${project.id}/requirements`)}
                    >
                      {project.name}
                    </button>
                    <div className="repo-caption" title={`${project.provider} · ${project.repo}`}>
                      {project.provider} · {project.repo}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`设置${project.name}`}
                    onClick={() => {
                      navigate(`/prototype/project/${project.id}/requirements`)
                      showToast('项目设置入口在项目工作区右上角')
                    }}
                  >
                    <PrototypeIcon name="settings" />
                  </button>
                </div>
                <div className="project-state-row">
                  <ProtoStatus status={project.status} />
                  <span className="project-owner">
                    <ProtoAvatar name={project.owner} />
                    {project.owner}
                  </span>
                </div>
                <div className="project-metrics">
                  {(
                    [
                      ['需求', metrics.requirements],
                      ['Bug', metrics.bugs],
                      ['PR', metrics.prs],
                      ['bots', metrics.bots],
                    ] as const
                  ).map(([tab, count]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() =>
                        navigate(
                          `/prototype/project/${project.id}/${tab === '需求' ? 'requirements' : tab === 'Bug' ? 'bugs' : tab === 'PR' ? 'prs' : 'collaboration'}`,
                        )
                      }
                    >
                      <strong>{count}</strong>
                      <span>{tab === 'PR' ? '待审 PR' : tab === 'bots' ? 'Bots' : `待处理${tab}`}</span>
                    </button>
                  ))}
                </div>
                <div className="project-card-footer">
                  <div className="project-progress">
                    <div className="progress-caption">
                      <span>
                        完成度 <b>{metrics.percent}%</b>
                      </span>
                      <span>
                        {metrics.done}/{metrics.total}
                      </span>
                    </div>
                    <progress max={100} value={metrics.percent} aria-label={`${project.name}事项完成度`}>
                      {metrics.percent}%
                    </progress>
                  </div>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => navigate(`/prototype/project/${project.id}/requirements`)}
                  >
                    进入项目 <PrototypeIcon name="arrow" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        {visibleProjects.length === 0 && (
          <div className="empty">
            <PrototypeIcon name="search" />
            <h3>没有匹配的项目</h3>
            <p>调整关键词或状态筛选后重试。</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery('')
                setStatusFilter('全部')
              }}
            >
              清除筛选
            </button>
          </div>
        )}
      </div>

      <PrototypeDialog
        open={selectedDay !== null}
        title={selectedDay ? `${selectedDay.date} · 活动` : '活动'}
        onClose={() => setSelectedDay(null)}
      >
        {selectedDay && (
          <div>
            <div className="activity-breakdown">
              {(['代码', '事项', 'PR', 'Bots'] as const).map((source) => (
                <div key={source}>
                  <span>{source}</span>
                  <strong>{selectedDay.counts[source]}</strong>
                </div>
              ))}
            </div>
            <p className="small quiet">过去一年的活动为本地示例数据，不代表远端真实提交或 PR。</p>
            <div className="form-actions">
              <button type="button" className="btn primary" onClick={() => setSelectedDay(null)}>
                关闭
              </button>
            </div>
          </div>
        )}
      </PrototypeDialog>

      <PrototypeDialog open={connectOpen} title="关联项目" onClose={() => setConnectOpen(false)}>
        <p className="info-box">在本原型中保存关联关系，不创建或复制远端仓库。</p>
        <div className="form-grid">
          <label className="field">
            代码平台
            <select
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value as DemoProject['provider'] })}
            >
              <option>GitHub</option>
              <option>Gitea</option>
            </select>
          </label>
          <label className="field">
            负责人
            <select value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })}>
              {demoMembers.map((member) => (
                <option key={member}>{member}</option>
              ))}
            </select>
          </label>
          <label className="field full">
            仓库路径（可选）
            <input
              value={form.repo}
              placeholder="team/repository；也可稍后关联"
              maxLength={100}
              onChange={(event) => setForm({ ...form, repo: event.target.value })}
            />
          </label>
          <label className="field full">
            项目名称
            <input
              value={form.name}
              placeholder="例如：客户工作台"
              maxLength={50}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setConnectOpen(false)}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={connect}>
            关联并进入项目
          </button>
        </div>
      </PrototypeDialog>
    </>
  )
}
