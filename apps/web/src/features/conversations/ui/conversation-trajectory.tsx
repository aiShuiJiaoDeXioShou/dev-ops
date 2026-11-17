import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import { conversationEventText, type ConversationEvents } from '../api/queries'
import { ConversationIcon } from './conversation-icon'

export const runLabels: Record<string, string> = {
  queued: '排队中',
  running: '深度求索中…',
  failed: '执行失败',
  stopped: '已停止生成',
  succeeded: '已完成',
}

export type ConversationRun = {
  id: string
  text: string
  name: string
  botId?: string
  status?: string
  statusText?: string
  createdAt?: string
  startedAt?: string
  firstOutputAt?: string
  finishedAt?: string
  stopRequested?: boolean
}

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

/**
 * 计算运行耗时。
 * @param run 带开始、结束时间的运行。
 * @param now 当前毫秒时间，用于仍在执行的运行。
 * @returns 可读耗时，没有开始时间时不显示。
 */
export function runElapsed(run: ConversationRun, now: number) {
  if (!run.startedAt) return undefined
  const seconds = Math.max(0, ((run.finishedAt ? Date.parse(run.finishedAt) : now) - Date.parse(run.startedAt)) / 1000)
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`
}

/**
 * 仅在有活动运行时刷新本地时钟，耗时以服务器记录的开始时间为准。
 * @param running 是否有活动运行。
 * @returns 用于更新显示的毫秒时间。
 */
export function useRunClock(running: boolean) {
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const update = () => setClock(Date.now())
    const timeout = window.setTimeout(update, 0)
    const timer = window.setInterval(update, 1000)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(timer)
    }
  }, [running])
  return clock
}

type TraceStep = {
  id: string
  title: string
  detail?: string
  at: string
  status: 'done' | 'running' | 'failed' | 'interrupted' | 'pending'
  type: 'tool' | 'chat'
}

function stepsFor(run: ConversationRun, events: ConversationEvents['items']): TraceStep[] {
  const steps: TraceStep[] = []
  if (run.createdAt)
    steps.push({
      id: 'queue',
      title: '排队等待执行',
      at: run.createdAt,
      status: run.status === 'queued' ? 'pending' : 'done',
      type: 'chat',
    })
  if (run.startedAt) steps.push({ id: 'start', title: '开始运行', at: run.startedAt, status: 'done', type: 'chat' })
  const toolSteps = new Map<string, TraceStep>()
  for (const { sequence, payload, createdAt } of events) {
    const state = conversationEventText(payload, 'state')
    if (state === 'memory_written') continue
    const id = conversationEventText(payload, 'callId') ?? sequence
    const name = conversationEventText(payload, 'name') ?? '工具调用'
    const target = [conversationEventText(payload, 'method'), conversationEventText(payload, 'path')]
      .filter(Boolean)
      .join(' ')
    const result = payload && typeof payload === 'object' ? Reflect.get(payload, 'ok') : undefined
    const started = toolSteps.get(id)
    const status =
      state === 'started'
        ? run.status === 'running'
          ? 'running'
          : 'interrupted'
        : state === 'succeeded' || result === true
          ? 'done'
          : 'failed'
    toolSteps.set(id, {
      id,
      title: name,
      status,
      type: 'tool',
      at: started?.at ?? createdAt,
      detail: [target, state === 'unknown' ? '调用结果未知' : conversationEventText(payload, 'code')]
        .filter(Boolean)
        .join(' · '),
    })
  }
  steps.push(...toolSteps.values())
  if (run.firstOutputAt)
    steps.push({
      id: 'output',
      title: '生成回答',
      at: run.firstOutputAt,
      type: 'chat',
      status: run.status === 'running' ? 'running' : run.status === 'stopped' ? 'interrupted' : 'done',
    })
  if (run.finishedAt)
    steps.push({
      id: 'finish',
      title: runLabels[run.status ?? ''] ?? '结束运行',
      detail: run.statusText,
      at: run.finishedAt,
      status: run.status === 'failed' ? 'failed' : run.status === 'stopped' ? 'interrupted' : 'done',
      type: 'chat',
    })
  return steps.sort((left, right) => left.at.localeCompare(right.at))
}

const stepStatus = { done: '已完成', running: '进行中', failed: '失败', interrupted: '已中断', pending: '等待' }

/**
 * 按原型显示运行切换、时间轴和可展开工具调用。
 * @param props 会话运行、真实事件、当前选中项和计时时钟。
 * @returns 当前会话的轨迹区。
 */
export function ConversationTrajectory({
  runs,
  events,
  selectedId,
  onSelect,
  now,
  onStop,
  stopError,
}: {
  runs: ConversationRun[]
  events: ConversationEvents['items']
  selectedId?: string
  onSelect: (id: string) => void
  now: number
  onStop?: (runId: string) => void
  stopError?: string
}) {
  const panel = useRef<HTMLOListElement>(null)
  const [expanded, setExpanded] = useState(false)
  const run = runs.find(({ id }) => id === selectedId) ?? runs[0]
  if (!run)
    return (
      <div className="dsh-empty">
        <span className="dsh-empty-icon">
          <ConversationIcon name="layers" />
        </span>
        <h3>还没有执行轨迹</h3>
        <p>发送消息后，可在这里查看运行和工具调用。</p>
      </div>
    )

  const steps = stepsFor(
    run,
    events.filter(({ runId }) => runId === run.id),
  )
  const stepStart = Date.parse(run.createdAt ?? run.startedAt ?? steps[0]?.at ?? '')
  const elapsed = runElapsed(run, now)
  const durations = steps.map((step, index) => {
    const end = steps[index + 1]?.at ?? run.finishedAt
    return Math.max(200, (end ? Date.parse(end) : now) - Date.parse(step.at))
  })
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0)
  let widthUsed = 0
  const segments = steps.map((step, index) => {
    const start = widthUsed
    const width = (1000 * (durations[index] ?? 0)) / totalDuration
    widthUsed += width
    return { ...step, start, width: Math.max(1, width - 3) }
  })
  return (
    <div className="traj-wrap">
      <div className="traj-toolbar">
        <div className="traj-toolbar-title">
          <strong>执行轨迹</strong>
          <span className="traj-count">{runs.length} 次运行</span>
        </div>
        <div className="traj-runs" role="group" aria-label="运行记录">
          {runs.map((item) => (
            <Button
              key={item.id}
              unstyled
              type="button"
              className={cn('traj-run', item.id === run.id && 'is-active')}
              aria-pressed={item.id === run.id}
              onClick={() => onSelect(item.id)}
            >
              <span
                className={cn(
                  'traj-run-dot',
                  item.status === 'running' ? 'streaming' : item.status === 'succeeded' ? 'done' : item.status,
                )}
                aria-hidden="true"
              />
              {item.createdAt && <span>{clock.format(new Date(item.createdAt))}</span>}
              <span className="traj-run-duration">
                {item.status === 'running' ? '进行中' : (runElapsed(item, now) ?? runLabels[item.status ?? ''])}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <section className="traj-detail" aria-label="运行详情">
        <div className="traj-detail-head">
          <div className="traj-detail-title">
            <span className="dsh-author">{run.name}</span>
            <span className={cn('traj-state', run.status === 'running' ? 'streaming' : run.status)}>
              {runLabels[run.status ?? '']}
            </span>
            <span className="traj-meta">{[elapsed, `${steps.length} 步`].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="traj-detail-actions">
            {onStop && run.status === 'running' && (
              <Button unstyled type="button" className="dsh-link" onClick={() => onStop(run.id)}>
                停止生成
              </Button>
            )}
            {steps.length > 0 && (
              <Button
                unstyled
                type="button"
                className="dsh-link"
                onClick={() => {
                  const rows = panel.current?.querySelectorAll('details')
                  const open = rows ? [...rows].some((row) => !row.open) : false
                  rows?.forEach((row) => {
                    row.open = open
                  })
                  setExpanded(open)
                }}
              >
                {expanded ? '收起全部' : '展开全部'}
              </Button>
            )}
          </div>
        </div>
        {stopError && (
          <p role="alert" className="field-error">
            {stopError}
          </p>
        )}
        {steps.length > 0 && (
          <>
            <svg
              className="traj-overview"
              viewBox="0 0 1000 8"
              preserveAspectRatio="none"
              aria-label="轨迹时间分布"
              role="img"
            >
              {segments.map(({ id, title, status, type, start, width }) => (
                <rect key={id} x={start} y={0} width={width} height={8} rx={2} className={cn('traj-seg', type, status)}>
                  <title>{title}</title>
                </rect>
              ))}
            </svg>
            <div className="traj-axis">
              <span>0 秒</span>
              {elapsed && <span>{elapsed}</span>}
            </div>
            <ol className="traj-list" ref={panel}>
              {steps.map((step) => (
                <li key={step.id} className={cn('traj-step', step.status)}>
                  <details className="traj-step-details">
                    <summary className="traj-row">
                      <span className="traj-time">
                        {Math.max(0, (Date.parse(step.at) - stepStart) / 1000).toFixed(1)}s
                      </span>
                      <span className={cn('traj-icon', step.type)}>
                        <ConversationIcon name={step.type === 'tool' ? 'layers' : 'chat'} />
                      </span>
                      <span className="traj-main">
                        <strong>{step.title}</strong>
                        {step.detail && <small>{step.detail}</small>}
                      </span>
                      <span className="traj-duration">{clock.format(new Date(step.at))}</span>
                      <span className="traj-status" aria-label={stepStatus[step.status]}>
                        {step.status === 'running' ? (
                          <span className="dsh-spinner" />
                        ) : step.status === 'pending' ? (
                          <span className="dsh-pending" />
                        ) : (
                          <ConversationIcon
                            name={step.status === 'done' ? 'check' : step.status === 'interrupted' ? 'stop' : 'close'}
                          />
                        )}
                      </span>
                    </summary>
                    <div className="traj-record">
                      <div className="traj-record-label">记录</div>
                      {step.detail && <p>{step.detail}</p>}
                      <div className="traj-record-meta">
                        <time dateTime={step.at}>{clock.format(new Date(step.at))}</time>
                        <span>状态 · {stepStatus[step.status]}</span>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  )
}
