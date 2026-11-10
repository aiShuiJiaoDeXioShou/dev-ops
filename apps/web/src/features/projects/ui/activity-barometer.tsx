import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from '@/shared/ui/controls/select'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { describeRequestError } from '@/shared/api/errors'
import { PageLoading } from '@/shared/ui/page-state'
import { projectActivityQueryOptions } from '../api/queries'

const SOURCES = [
  { value: 'all', label: '全部' },
  { value: 'activity', label: '事项' },
  { value: 'code', label: '代码' },
  { value: 'pull_request', label: 'PR' },
] as const
type Source = (typeof SOURCES)[number]['value']

const WEEKDAY_LABELS = ['一', '三', '五'] as const
const DAY_MS = 24 * 60 * 60 * 1000

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** 计算与原型一致的活动等级：0、1–3、4–6、7–10、>10。 */
function levelOf(value: number): number {
  if (value === 0) return 0
  if (value <= 3) return 1
  if (value <= 6) return 2
  if (value <= 10) return 3
  return 4
}

interface CalendarDay {
  date: string
  total: number
  counts: { activity: number; code: number; pullRequest: number }
  future?: boolean
}

/**
 * 项目首页活动晴雨表：严格沿用原型的热力图、来源筛选、月份/星期刻度与日期弹窗。
 * @param props.teamId 当前团队；search/status 与项目列表筛选保持一致。
 * @returns 过去一年 UTC 日历热力图；来源未知时在文案中标注，不伪造为 0。
 */
export function ActivityBarometer({ teamId, search, status }: { teamId: string; search: string; status: string }) {
  const [source, setSource] = useState<Source>('all')
  const [selected, setSelected] = useState<CalendarDay | null>(null)
  const query = useQuery(
    projectActivityQueryOptions(teamId, {
      ...(search ? { search } : {}),
      ...(status ? { status: status as 'active' | 'paused' | 'ended' } : {}),
      source,
    }),
  )
  if (query.isPending) return <PageLoading message="项目晴雨表加载中…" />
  if (query.isError) {
    return (
      <p className="section-note" role="alert">
        项目晴雨表加载失败：{describeRequestError(query.error).description}
      </p>
    )
  }
  const data = query.data.data
  const days: CalendarDay[] = data.days.map((day) => ({
    date: day.date,
    total: day.total,
    counts: day.counts,
  }))
  // API 默认窗口从周日开始；把当前周剩余日期补成 future 占位，保持 53×7 网格。
  const lastDate = days.at(-1)?.date
  if (lastDate) {
    const last = new Date(`${lastDate}T00:00:00.000Z`)
    let cursor = addDays(last, 1)
    while (cursor.getUTCDay() !== 0) {
      days.push({
        date: cursor.toISOString().slice(0, 10),
        total: 0,
        counts: { activity: 0, code: 0, pullRequest: 0 },
        future: true,
      })
      cursor = addDays(cursor, 1)
    }
  }
  const total = days.filter((day) => !day.future).reduce((sum, day) => sum + day.total, 0)
  const weeks: CalendarDay[][] = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7))
  }
  const months = weeks.map((week) => {
    const first = week[0]
    if (!first) return ''
    const date = new Date(`${first.date}T00:00:00.000Z`)
    return date.getUTCDate() <= 7 && weeks.indexOf(week) < 52 ? `${date.getUTCMonth() + 1}月` : ''
  })
  return (
    <section className="activity-map" aria-label="项目活动晴雨表">
      <div className="activity-heading">
        <strong>项目晴雨表</strong>
        <span className="small quiet">过去一年 · {total} 次活动</span>
        <span className="spacer" />
        {data.sourceStatus.code !== 'ok' ? <span className="tag">代码未同步</span> : null}
        {data.sourceStatus.pullRequest !== 'ok' ? <span className="tag">PR 未同步</span> : null}
        <Select
          className="activity-source"
          aria-label="活动来源"
          value={source}
          onChange={(event) => setSource(event.target.value as Source)}
        >
          {SOURCES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="activity-scroll">
        <div className="activity-calendar">
          <div className="activity-months">
            {months.map((month, index) => (
              <span key={index}>{month}</span>
            ))}
          </div>
          <div className="activity-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="activity-grid" role="grid" aria-label="过去一年活动热力图">
            {days.map((day) => {
              if (day.future) return <span key={day.date} className="activity-day future" />
              const label = `${day.date} · ${day.total} 次活动`
              return (
                <span
                  key={day.date}
                  role="button"
                  tabIndex={0}
                  title={label}
                  aria-label={label}
                  className={`activity-day level-${levelOf(day.total)}`}
                  onClick={() => setSelected(day)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelected(day)
                    }
                  }}
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
      <Dialog open={selected !== null} onOpenChange={(open) => (open ? undefined : setSelected(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected ? `${selected.date} · 活动` : '活动'}</DialogTitle>
          </DialogHeader>
          {selected ? (
            <>
              <div className="activity-breakdown">
                {[
                  ['代码', selected.counts.code],
                  ['事项', selected.counts.activity],
                  ['PR', selected.counts.pullRequest],
                  ['Bots', '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setSelected(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
