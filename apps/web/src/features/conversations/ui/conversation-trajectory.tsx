import { ArrowRight, Bot, Clock3, Search, UserRound, Wrench, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/controls/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { conversationTraceOptions } from '../api/queries'
import {
  traceLanes,
  traceStatuses,
  traceSteps,
  type ConversationRun,
  type TraceStep,
} from '../model/conversation-trace'
import './conversation-trajectory.css'

export const runLabels: Record<string, string> = {
  queued: '排队中',
  running: '深度求索中…',
  failed: '执行失败',
  stopped: '已停止生成',
  succeeded: '已完成',
}

const lanes = ['input', 'model', 'tool'] as const
const laneIcons = { input: UserRound, model: Bot, tool: Wrench }
const detailDrawer = '(width < 1280px)'
const clock = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const number = new Intl.NumberFormat('zh-CN')

function seconds(ms: number) {
  return `${(Math.max(0, ms) / 1_000).toFixed(1)} 秒`
}

function clockTime(at: string) {
  return clock.format(new Date(at))
}

/**
 * 计算运行耗时。
 * @param run 带开始、结束时间的运行。
 * @param now 当前毫秒时间，用于仍在执行的运行。
 * @returns 可读耗时，没有完整时间时不显示。
 */
export function runElapsed(run: ConversationRun, now: number) {
  if (!run.startedAt) return undefined
  const end = run.finishedAt ? Date.parse(run.finishedAt) : run.status === 'running' ? now : undefined
  return end === undefined ? undefined : seconds(end - Date.parse(run.startedAt))
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

function subscribeToDrawer(change: () => void) {
  const media = window.matchMedia(detailDrawer)
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}

function plainPreview(step: TraceStep) {
  return [step.text, step.target, step.note, step.code].filter(Boolean).join('\n')
}

function TraceInspector({ step }: { step: TraceStep }) {
  const content = plainPreview(step)
  const duration = step.endAt ? Date.parse(step.endAt) - Date.parse(step.at) : 0
  return (
    <Tabs defaultValue="overview" className="trace-inspector-tabs">
      <TabsList unstyled className="trace-detail-tabs" aria-label="步骤详情视图">
        <TabsTrigger variant="underline" value="overview">
          概况
        </TabsTrigger>
        <TabsTrigger variant="underline" value="preview">
          预览
        </TabsTrigger>
        <TabsTrigger variant="underline" value="record">
          事件
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="trace-inspector-content">
        <dl className="trace-properties">
          <dt>类型</dt>
          <dd>{traceLanes[step.kind]}</dd>
          <dt>状态</dt>
          <dd>{traceStatuses[step.status]}</dd>
          <dt>记录时间</dt>
          <dd>
            <time dateTime={step.at}>{clockTime(step.at)}</time>
          </dd>
          {step.endAt && (
            <>
              <dt>{step.kind === 'tool' ? '结束时间' : '末次输出'}</dt>
              <dd>
                <time dateTime={step.endAt}>{clockTime(step.endAt)}</time>
              </dd>
              {duration > 0 && (
                <>
                  <dt>{step.kind === 'tool' ? '耗时' : '输出用时'}</dt>
                  <dd>{seconds(duration)}</dd>
                </>
              )}
            </>
          )}
          {step.target && (
            <>
              <dt>接口</dt>
              <dd>
                <code>{step.target}</code>
              </dd>
            </>
          )}
          {step.code && (
            <>
              <dt>结果码</dt>
              <dd>
                <code>{step.code}</code>
              </dd>
            </>
          )}
        </dl>
        {(step.text || step.note) && <pre className="trace-content-preview">{step.text ?? step.note}</pre>}
      </TabsContent>
      <TabsContent value="preview" className="trace-inspector-content">
        {content ? (
          <pre className="trace-pre">{content}</pre>
        ) : (
          <p className="trace-muted">这一步仅记录了状态和时间。</p>
        )}
      </TabsContent>
      <TabsContent value="record" className="trace-inspector-content">
        <pre className="trace-pre">
          {JSON.stringify(
            {
              sequence: step.sequence,
              type: step.kind,
              name: step.title,
              status: step.status,
              time: step.at,
              endTime: step.endAt,
              target: step.target,
              code: step.code,
            },
            null,
            2,
          )}
        </pre>
      </TabsContent>
    </Tabs>
  )
}

function TraceTimeline({
  steps,
  run,
  now,
  selectedId,
  onPick,
}: {
  steps: TraceStep[]
  run: ConversationRun
  now: number
  selectedId?: string
  onPick: (step: TraceStep, opener: HTMLButtonElement) => void
}) {
  const origin = Date.parse(steps[0]?.at ?? '')
  const recordedEnd = Math.max(origin, ...steps.map(({ at, endAt }) => Date.parse(endAt ?? at)))
  const end = run.status === 'running' ? Math.max(recordedEnd, now) : recordedEnd
  const span = Math.max(1, end - origin)
  const location = (at: string) => ((Date.parse(at) - origin) / span) * 100
  function pick(lane: TraceStep[], event: MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const target = event.detail === 0 ? 0 : ((event.clientX - bounds.left) / bounds.width) * 100
    let nearest: TraceStep | undefined
    let distance = Number.POSITIVE_INFINITY
    for (const step of lane) {
      const left = location(step.at)
      const right = step.endAt ? location(step.endAt) : left
      const delta = Math.max(left - target, target - right, 0)
      if (delta < distance) {
        nearest = step
        distance = delta
      }
    }
    if (nearest) onPick(nearest, event.currentTarget)
  }

  return (
    <section className="trace-timeline" aria-label="运行时间线">
      {lanes.map((kind) => {
        const lane = steps.filter((step) => step.kind === kind)
        return (
          <div className="trace-lane" key={kind} data-kind={kind}>
            <span>{traceLanes[kind]}</span>
            <Button
              unstyled
              type="button"
              className="trace-lane-track"
              aria-label={`定位${traceLanes[kind]}`}
              disabled={lane.length === 0}
              onClick={(event) => pick(lane, event)}
            >
              <svg className="trace-track-graphic" viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
                {lane.map((step) => {
                  const left = location(step.at)
                  const width = step.endAt ? location(step.endAt) - left : 0
                  const x = Math.min(994, left * 10)
                  return (
                    <rect
                      key={step.id}
                      className="trace-marker"
                      data-status={step.status}
                      data-selected={selectedId === step.id}
                      x={x}
                      y={10}
                      width={Math.min(1000 - x, Math.max(6, width * 10))}
                      height={12}
                    >
                      <title>{step.title}</title>
                    </rect>
                  )
                })}
              </svg>
            </Button>
          </div>
        )
      })}
      <div className="trace-time-axis">
        <span>0 秒</span>
        <span>{seconds(end - origin)}</span>
      </div>
    </section>
  )
}

function TraceRun({
  run,
  conversationId,
  now,
  onStop,
  stopError,
}: {
  run: ConversationRun
  conversationId: string
  now: number
  onStop?: (runId: string) => void
  stopError?: string
}) {
  const client = useQueryClient()
  const trace = useQuery(conversationTraceOptions(client, conversationId, run.id))
  const [filter, setFilter] = useState<TraceStep['kind'] | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const opener = useRef<HTMLElement>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const titleId = useId()
  const useDrawer = useSyncExternalStore(
    subscribeToDrawer,
    () => window.matchMedia(detailDrawer).matches,
    () => false,
  )
  const traceEvents = trace.data?.items
  const { id, status, input, reply } = run
  const steps = useMemo(
    () => traceSteps({ id, status, input, reply }, traceEvents ?? []),
    [id, status, input, reply, traceEvents],
  )
  const selected = steps.find(({ id }) => id === selectedId)
  const term = search.trim().toLowerCase()
  const filtered = steps.filter(
    (step) =>
      (filter === 'all' || step.kind === filter) &&
      (!term ||
        [step.title, traceLanes[step.kind], traceStatuses[step.status], plainPreview(step)]
          .join(' ')
          .toLowerCase()
          .includes(term)),
  )
  const metrics = run.reply?.body.metrics
  const elapsed = runElapsed(run, now) ?? (metrics && seconds(metrics.durationMs))
  const runStatus =
    run.status === 'running' ? (run.stopRequested ? '正在停止…' : '运行中') : runLabels[run.status ?? '']
  function select(step: TraceStep, target: HTMLButtonElement, jump = false) {
    const row = rows.current.get(step.id)
    opener.current = jump && row ? row : target
    if (jump && row) {
      row.scrollIntoView({ block: 'nearest' })
      row.focus({ preventScroll: true })
    } else if (jump) {
      requestAnimationFrame(() => rows.current.get(step.id)?.scrollIntoView({ block: 'nearest' }))
    }
    setSelectedId(step.id)
  }
  function closeDetail() {
    setSelectedId(undefined)
    opener.current?.focus({ preventScroll: true })
  }

  return (
    <section
      aria-label="运行详情"
      className="trace-run-detail"
      onKeyDown={(event) => {
        if (!useDrawer && selected && event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          closeDetail()
        }
      }}
    >
      <div className="trace-controls">
        <div className="trace-run-meta">
          <strong>{run.name}</strong>
          {runStatus && (
            <span className="trace-run-status" data-status={run.status}>
              {runStatus}
            </span>
          )}
          {elapsed && (
            <span className="trace-muted inline-flex items-center gap-1">
              <Clock3 size={14} />
              {elapsed}
            </span>
          )}
          {metrics && (
            <span className="trace-muted">
              {metrics.turns} 轮 · {number.format(metrics.inputTokens + metrics.outputTokens)} Token
            </span>
          )}
        </div>
        {onStop && run.status === 'running' && (
          <Button variant="outline" type="button" onClick={() => onStop(run.id)}>
            停止生成
          </Button>
        )}
      </div>
      {stopError && (
        <p role="alert" className="field-error trace-notice">
          {stopError}
        </p>
      )}
      {trace.isError &&
        (trace.data ? (
          <div className="trace-notice trace-refresh" role="status">
            轨迹更新失败
            <Button variant="ghost" type="button" disabled={trace.isFetching} onClick={() => void trace.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <PageError
            title="轨迹加载失败"
            error={trace.error}
            retrying={trace.isFetching}
            onRetry={() => void trace.refetch()}
          />
        ))}
      <DelayedLoading pending={trace.isPending}>
        <div className="trace-notice">
          <PageLoading message="轨迹加载中…" />
        </div>
      </DelayedLoading>
      {trace.data && (
        <>
          <div className="filters trace-filters">
            <div className="trace-filters-group" role="group" aria-label="步骤类型">
              {(['all', ...lanes] as const).map((kind) => (
                <Button
                  key={kind}
                  unstyled
                  type="button"
                  className="trace-filter"
                  aria-pressed={filter === kind}
                  onClick={() => {
                    setFilter(kind)
                    setSelectedId(undefined)
                  }}
                >
                  {kind === 'all' ? '全部' : traceLanes[kind]}
                </Button>
              ))}
            </div>
            <label className="search trace-search">
              <Search size={16} aria-hidden="true" />
              <Input
                className="h-full border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                type="search"
                aria-label="搜索运行轨迹"
                placeholder="搜索步骤"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setSelectedId(undefined)
                }}
              />
            </label>
          </div>
          {steps.length > 0 && (
            <TraceTimeline
              steps={steps}
              run={run}
              now={now}
              selectedId={selected?.id}
              onPick={(step, target) => {
                if (!filtered.includes(step)) {
                  setFilter('all')
                  setSearch('')
                }
                select(step, target, true)
              }}
            />
          )}
          <div className="trace-workspace" data-inspecting={Boolean(selected && !useDrawer)}>
            <div className="trace-list-scroll">
              {filtered.length ? (
                <ol className="trace-steps" aria-label="运行步骤">
                  {filtered.map((step) => {
                    const Icon = laneIcons[step.kind]
                    const preview = plainPreview(step)
                    return (
                      <li key={step.id}>
                        <Button
                          unstyled
                          type="button"
                          className="trace-step"
                          data-kind={step.kind}
                          aria-pressed={selected?.id === step.id}
                          onClick={(event) => select(step, event.currentTarget)}
                          ref={(element) => {
                            if (element) rows.current.set(step.id, element)
                            else rows.current.delete(step.id)
                          }}
                        >
                          <span className="trace-step-icon">
                            <Icon size={15} aria-hidden="true" />
                          </span>
                          <span className="trace-step-copy">
                            <strong>{step.title}</strong>
                            {preview && <small>{preview}</small>}
                          </span>
                          <span className="trace-step-state" data-status={step.status}>
                            {traceStatuses[step.status]}
                          </span>
                          <time className="trace-step-time" dateTime={step.at}>
                            {clockTime(step.at).split(' ').at(-1)}
                          </time>
                          <ArrowRight size={14} className="trace-step-arrow" aria-hidden="true" />
                        </Button>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <EmptyState
                  title={steps.length ? '没有匹配的步骤' : '这次运行暂无步骤'}
                  icon={<Search />}
                  action={
                    steps.length > 0 && (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                          setFilter('all')
                          setSearch('')
                        }}
                      >
                        清除筛选
                      </Button>
                    )
                  }
                />
              )}
              {trace.data.hasMore && (
                <p className="trace-notice trace-muted" role="status">
                  正在加载更多步骤…
                </p>
              )}
            </div>
            {selected && !useDrawer && (
              <aside className="trace-inspector" aria-labelledby={titleId}>
                <div className="trace-inspector-head">
                  <h3 id={titleId}>{selected.title}</h3>
                  <Button variant="ghost" size="icon" type="button" aria-label="关闭步骤详情" onClick={closeDetail}>
                    <X />
                  </Button>
                </div>
                <TraceInspector key={selected.id} step={selected} />
              </aside>
            )}
          </div>
        </>
      )}
      {useDrawer && (
        <Sheet
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelectedId(undefined)
          }}
        >
          <SheetContent
            className="trace-sheet w-full! max-w-lg!"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              opener.current?.focus({ preventScroll: true })
            }}
          >
            {selected && (
              <>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription className="sr-only">运行步骤详情</SheetDescription>
                <TraceInspector key={selected.id} step={selected} />
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
    </section>
  )
}

/**
 * 展示当前会话运行的时间线及步骤详情。
 * @param props 会话、执行中或最近一次运行和停止生成所需状态。
 * @returns 运行轨迹区域或尚无运行的空状态。
 */
export function ConversationTrajectory({
  conversationId,
  run,
  now,
  onStop,
  stopError,
}: {
  conversationId: string
  run?: ConversationRun
  now: number
  onStop?: (runId: string) => void
  stopError?: string
}) {
  if (!run) {
    return (
      <EmptyState title="还没有执行轨迹" description="发送消息后，可在这里查看运行步骤和工具调用。" mascot="signal" />
    )
  }

  return (
    <TraceRun key={run.id} run={run} conversationId={conversationId} now={now} onStop={onStop} stopError={stopError} />
  )
}
