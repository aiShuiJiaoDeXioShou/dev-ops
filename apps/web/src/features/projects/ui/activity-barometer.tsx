import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { Select } from '@/shared/ui/controls/select'
import { projectActivityQueryOptions } from '../api/queries'

const SOURCES = [
  { value: 'all', label: '全部来源' },
  { value: 'activity', label: '事项' },
  { value: 'code', label: '代码提交' },
  { value: 'pull_request', label: 'PR' },
] as const
type Source = (typeof SOURCES)[number]['value']

const LEVELS = [0, 3, 6, 10] as const
function levelOf(value: number): number {
  if (value === 0) return 0
  if (value <= LEVELS[1]) return 1
  if (value <= LEVELS[2]) return 2
  if (value <= LEVELS[3]) return 3
  return 4
}

/**
 * 项目首页活动晴雨表：过去一年按日热力图、来源切换与项目摘要。
 * @param props.teamId 当前团队；filters 与项目列表的搜索/状态筛选保持一致。
 * @returns 热力图、日期明细与项目摘要；来源未知时不显示为 0。
 */
export function ActivityBarometer({ teamId, search, status }: { teamId: string; search: string; status: string }) {
  const [source, setSource] = useState<Source>('all')
  const [selectedDate, setSelectedDate] = useState('')
  const query = useQuery(
    projectActivityQueryOptions(teamId, {
      ...(search ? { search } : {}),
      ...(status ? { status: status as 'active' | 'paused' | 'ended' } : {}),
      source,
    }),
  )
  if (query.isPending) return <PageLoading />
  if (query.isError) {
    return <EmptyState title="项目晴雨表加载失败" description={describeRequestError(query.error).description} />
  }
  const data = query.data.data
  const selected = data.days.find((day) => day.date === selectedDate) ?? null
  return (
    <section className="activity-map" aria-label="项目活动晴雨表">
      <div className="activity-heading">
        <strong>项目晴雨表</strong>
        <span className="small quiet">
          {data.from} 至 {data.to} · 共 {data.days.reduce((sum, day) => sum + day.total, 0)} 次活动
        </span>
        <span className="spacer" />
        <span className="small quiet">时区 UTC</span>
        <Select aria-label="活动来源" value={source} onChange={(event) => setSource(event.target.value as Source)}>
          {SOURCES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="activity-scroll">
        <div className="activity-grid" role="grid" aria-label="过去一年活动热力图">
          {data.days.map((day) => (
            <div
              key={day.date}
              role="button"
              tabIndex={0}
              aria-label={`${day.date} ${day.total} 次活动`}
              className={`activity-day level-${levelOf(day.total)}`}
              onClick={() => setSelectedDate(day.date)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedDate(day.date)
                }
              }}
            />
          ))}
        </div>
      </div>
      <div className="activity-footer">
        <span>
          代码 {data.sourceStatus.code === 'ok' ? '可读' : '未同步'} · 事项可读 · PR{' '}
          {data.sourceStatus.pullRequest === 'ok' ? '可读' : '未同步'}
        </span>
        <div className="activity-legend" aria-label="颜色越深活动越多">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`activity-day level-${level}`} />
          ))}
          <span>多</span>
        </div>
      </div>
      {selected ? (
        <p className="small quiet">
          {selected.date}：事项 {selected.counts.activity} · 代码 {selected.counts.code} · PR{' '}
          {selected.counts.pullRequest}
        </p>
      ) : null}
      <h3>项目摘要</h3>
      {data.projects.length === 0 ? (
        <p className="muted">当前筛选没有项目。</p>
      ) : (
        <ul className="plain-list">
          {data.projects.map((project) => (
            <li key={project.projectId}>
              <Link to={`/projects/${project.projectId}/requirements`}>{project.projectId.slice(0, 8)}</Link>
              <span className="muted">
                完成 {project.items.completed}/{project.items.total}
              </span>
              <Link to={`/projects/${project.projectId}/requirements`}>待处理需求 {project.pendingRequirements}</Link>
              <Link to={`/projects/${project.projectId}/bugs`}>待处理 Bug {project.pendingBugs}</Link>
              <span className="muted">
                待审 PR {project.pendingPullRequests === null ? '未知' : project.pendingPullRequests}
              </span>
              <span className="muted">Bot 未开放</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
