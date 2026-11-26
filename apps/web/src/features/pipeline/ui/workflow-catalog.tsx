import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, FileCode2, Layers, Play } from 'lucide-react'
import { formatRelativeTime } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { pipelineWorkflowDetailQueryOptions } from '../api/workflows'
import { formatCompactDuration, formatDurationSeconds, parseErrorLocation } from '../lib/format'
import { isRunActive, runStatusLabel } from '../lib/status'
import type { PipelineRunSummary, PipelineWorkflowSummary } from '../model/types'
import { PipelineStatusIcon } from './pipeline-status-icon'

interface WorkflowRailProps {
  /** 仓库解析出的全部工作流。 */
  workflows: PipelineWorkflowSummary[]
  /** 当前选中的工作流路径；空字符串表示“全部工作流”。 */
  selectedPath: string
  /** 当前筛选条件下（或全部）的运行总数。 */
  totalRuns: number
  /** 当前页中正在推进的运行数。 */
  activeRunCount: number
  /** 切换工作流选择回调；空字符串回到全部。 */
  onSelect: (workflowPath: string) => void
}

/**
 * 左侧工作流目录与移动端横向胶囊切换栏。
 *
 * 展示每个工作流的最近状态图标、执行节点标签、阶段与步骤规模、最近 5 次趋势条及耗时，
 * 替代旧版仅有名称和静态绿点的空白工作流表。
 * @param props 工作流列表、当前选中路径、运行统计与切换回调。
 * @returns 桌面侧栏目录和移动端横向工作流栏。
 */
export function WorkflowRail({ workflows, selectedPath, totalRuns, activeRunCount, onSelect }: WorkflowRailProps) {
  const validCount = workflows.filter((item) => item.valid).length
  const invalidCount = workflows.length - validCount

  return (
    <>
      <div className="pl-mobile-workflow-bar" role="tablist" aria-label="切换工作流">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={selectedPath === ''}
          className={`pl-mobile-wf-pill ${selectedPath === '' ? 'active' : ''}`}
          onClick={() => onSelect('')}
        >
          <Layers size={13} aria-hidden="true" />
          全部工作流（{totalRuns}）
        </Button>
        {workflows.map((wf) => (
          <Button
            key={wf.path}
            type="button"
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={selectedPath === wf.path}
            className={`pl-mobile-wf-pill ${selectedPath === wf.path ? 'active' : ''}`}
            onClick={() => onSelect(wf.path)}
          >
            <span className={`pl-node-dot ${wf.valid ? 'online' : 'offline'}`} aria-hidden="true" />
            {wf.name ?? wf.path}
          </Button>
        ))}
      </div>

      <aside className="pl-workflow-rail" aria-label="仓库工作流目录">
        <div className="pl-rail-header">
          <span>工作流（{workflows.length}）</span>
          <span>最近趋势</span>
        </div>

        <Button
          type="button"
          variant="ghost"
          className={`pl-workflow-item ${selectedPath === '' ? 'active' : ''}`}
          aria-pressed={selectedPath === ''}
          onClick={() => onSelect('')}
        >
          <span className="pl-wf-top">
            <Layers size={14} className="pl-tone-running pl-icon" aria-hidden="true" />
            <span className="pl-wf-name">全部工作流</span>
            <span className="pl-wf-count">{totalRuns}</span>
          </span>
          <span className="pl-wf-meta">
            <span>{validCount} 个可运行</span>
            {invalidCount > 0 ? <span className="pl-wf-tag danger">{invalidCount} 个解析失败</span> : null}
            {activeRunCount > 0 ? <span className="pl-wf-tag">{activeRunCount} 个进行中</span> : null}
          </span>
        </Button>

        {workflows.map((wf) => {
          const isSelected = selectedPath === wf.path
          const title = wf.name ?? wf.path
          const lastDur = formatCompactDuration(wf.lastRun?.durationSeconds)
          return (
            <Button
              key={wf.path}
              type="button"
              variant="ghost"
              className={`pl-workflow-item ${isSelected ? 'active' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(wf.path)}
            >
              <span className="pl-wf-top">
                {wf.valid ? (
                  wf.lastRun ? (
                    <PipelineStatusIcon status={wf.lastRun.status} size={14} />
                  ) : (
                    <span className="pl-node-dot online" aria-hidden="true" />
                  )
                ) : (
                  <AlertCircle size={14} className="pl-tone-danger pl-icon" aria-hidden="true" />
                )}
                <span className="pl-wf-name">{title}</span>
              </span>

              <span className="pl-wf-meta">
                {wf.valid ? (
                  <>
                    {wf.runsOn[0] ? <span className="pl-wf-tag mono">{wf.runsOn[0]}</span> : null}
                    {wf.stepCount > 0 ? (
                      <span>
                        {wf.jobCount > 1 ? `${wf.jobCount} 阶段 · ` : ''}
                        {wf.stepCount} 步
                      </span>
                    ) : (
                      <span>可运行</span>
                    )}
                    {wf.inputCount > 0 ? <span>· {wf.inputCount} 参数</span> : null}
                  </>
                ) : (
                  <span className="pl-wf-tag danger">解析失败（{wf.parseErrors.length} 处错误）</span>
                )}
              </span>

              <span className="pl-wf-footer">
                <span className="pl-trend-bars" aria-label="最近运行趋势">
                  {wf.recentStatuses.length > 0
                    ? wf.recentStatuses.map((status, idx) => (
                        <span
                          key={`${wf.path}-trend-${idx}`}
                          className={`pl-trend-bar ${status}`}
                          title={runStatusLabel(status)}
                        />
                      ))
                    : [0, 1, 2].map((idx) => <span key={idx} className="pl-trend-bar" title="暂无运行记录" />)}
                </span>
                <span className="pl-wf-last-time">
                  {wf.lastRun
                    ? `${lastDur ? `${lastDur} · ` : ''}${formatRelativeTime(wf.lastRun.createdAt)}`
                    : '尚未运行'}
                </span>
              </span>
            </Button>
          )
        })}
      </aside>
    </>
  )
}

interface WorkflowSummaryCardProps {
  /** 项目标识，用于按需读取静态执行链路。 */
  projectId: string
  /** 当前选中的工作流摘要。 */
  workflow: PipelineWorkflowSummary
  /** 解析基准 ref。 */
  refName: string
  /** 当前角色是否允许手动触发。 */
  canTrigger: boolean
  /** 打开 YAML 与执行计划详情弹窗。 */
  onInspect: (workflow: PipelineWorkflowSummary) => void
  /** 打开触发弹窗。 */
  onTrigger: (workflow: PipelineWorkflowSummary, triggerElement: HTMLElement | null) => void
}

/**
 * 选中单个工作流时展示的具体配置、静态链路预览与解析错误定位卡片。
 * @param props 工作流摘要、权限与操作回调。
 * @returns 工作流详情摘要卡片。
 */
export function WorkflowSummaryCard({
  projectId,
  workflow,
  refName,
  canTrigger,
  onInspect,
  onTrigger,
}: WorkflowSummaryCardProps) {
  const detail = useQuery({
    ...pipelineWorkflowDetailQueryOptions(projectId, workflow.path, refName || undefined),
    enabled: Boolean(projectId && workflow.path && workflow.valid),
    retry: false,
  })
  const planJobs = detail.data?.workflow.planJobs ?? []
  const inputs = detail.data?.workflow.inputs ?? []

  return (
    <section aria-label="当前工作流摘要" className={`pl-workflow-summary ${workflow.valid ? '' : 'invalid'}`}>
      <div className="pl-wf-summary-head">
        <div className="space-y-1">
          <div className="pl-wf-summary-title">
            <h2>{workflow.name ?? workflow.path}</h2>
            {workflow.valid ? (
              <span className="pl-status-badge pl-tone-success">可运行</span>
            ) : (
              <span className="pl-status-badge pl-tone-danger">解析失败</span>
            )}
            <Badge variant="secondary" className="mono">
              {workflow.path}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onInspect(workflow)}>
            <FileCode2 size={14} aria-hidden="true" />
            查看 YAML 与计划
          </Button>
          {workflow.valid && canTrigger ? (
            <Button type="button" size="sm" onClick={(event) => onTrigger(workflow, event.currentTarget)}>
              <Play size={14} aria-hidden="true" />
              触发此工作流
            </Button>
          ) : !workflow.valid ? (
            <Badge variant="outline">不可触发</Badge>
          ) : null}
        </div>
      </div>

      <div className="pl-wf-facts">
        <span className="pl-wf-fact">
          <span className="pl-wf-fact-label">触发方式</span>
          <span className="mono">workflow_dispatch</span>
        </span>
        <span className="pl-wf-fact">
          <span className="pl-wf-fact-label">执行节点</span>
          <span className="mono">{workflow.runsOn.join(', ') || '—'}</span>
        </span>
        <span className="pl-wf-fact">
          <span className="pl-wf-fact-label">执行规模</span>
          <span>{workflow.jobCount > 0 ? `${workflow.jobCount} 阶段 · ${workflow.stepCount} 步` : '—'}</span>
        </span>
        {workflow.timeoutMinutes !== null ? (
          <span className="pl-wf-fact">
            <span className="pl-wf-fact-label">超时上限</span>
            <span>{workflow.timeoutMinutes} 分钟</span>
          </span>
        ) : null}
        <span className="pl-wf-fact">
          <span className="pl-wf-fact-label">输入参数</span>
          <span>
            {inputs.length > 0
              ? inputs
                  .map((item) =>
                    item.defaultValue !== undefined ? `${item.name}=${String(item.defaultValue)}` : item.name,
                  )
                  .join(' · ')
              : workflow.inputCount > 0
                ? `${workflow.inputCount} 个参数`
                : '无'}
          </span>
        </span>
      </div>

      {workflow.valid ? (
        planJobs.length > 0 ? (
          <div className="pl-blueprint-strip" aria-label="工作流阶段链路预览">
            {planJobs.map((job, jobIdx) => (
              <div key={job.id} className="pl-blueprint-item">
                {jobIdx > 0 ? <ArrowRight size={14} className="pl-blueprint-arrow" aria-hidden="true" /> : null}
                <div className="pl-blueprint-job">
                  <span className="pl-blueprint-job-name">{job.name}</span>
                  <span className="pl-blueprint-steps">{job.steps.map((s) => s.name).join(' → ')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null
      ) : (
        <section className="pl-parse-errors" aria-label="解析错误">
          {workflow.parseErrors.map((err, index) => (
            <div key={`${err.code}-${index}`} className="pl-parse-error-item">
              <AlertCircle size={15} className="pl-tone-danger pl-icon" aria-hidden="true" />
              <div className="space-y-1">
                <div className="pl-parse-error-meta">
                  <span className="mono">{workflow.path}</span>
                  <span className="mono">{parseErrorLocation(err)}</span>
                  <Badge variant="destructive">{err.code}</Badge>
                </div>
                <p className="text-foreground">{err.message}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </section>
  )
}

/**
 * “全部工作流”视图下的 4 格流水线健康指标条。
 * @param props 工作流列表与当前页运行记录。
 * @returns 紧凑汇总指标区。
 */
export function PipelineOverviewMetrics({
  workflows,
  runs,
}: {
  workflows: PipelineWorkflowSummary[]
  runs: PipelineRunSummary[]
}) {
  const validCount = workflows.filter((item) => item.valid).length
  const activeCount = runs.filter((item) => isRunActive(item.status)).length
  const succeeded = runs.filter((item) => item.status === 'succeeded')
  const failed = runs.filter((item) => item.status === 'failed' || item.status === 'interrupted')
  const finishedTotal = succeeded.length + failed.length
  const passRate = finishedTotal > 0 ? Math.round((succeeded.length / finishedTotal) * 100) : null
  const durations = succeeded
    .map((item) => item.durationSeconds)
    .filter((value): value is number => typeof value === 'number' && value >= 0)
  const avgDuration =
    durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null

  return (
    <div className="pl-overview-metrics" aria-label="流水线概览指标">
      <div className="pl-metric-card">
        <span className="pl-metric-label">进行中 / 排队</span>
        <span className="pl-metric-value">
          <span className={activeCount > 0 ? 'pl-tone-running' : undefined}>{activeCount}</span>
          <span className="pl-metric-sub">实时推进</span>
        </span>
      </div>
      <div className="pl-metric-card">
        <span className="pl-metric-label">可运行工作流</span>
        <span className="pl-metric-value">
          {validCount}
          <span className="pl-metric-sub">/ {workflows.length} 个定义</span>
        </span>
      </div>
      <div className="pl-metric-card">
        <span className="pl-metric-label">近期成功率</span>
        <span className="pl-metric-value">
          <span className={passRate !== null && passRate >= 80 ? 'pl-tone-success' : undefined}>
            {passRate === null ? '—' : `${passRate}%`}
          </span>
          <span className="pl-metric-sub">
            {finishedTotal > 0 ? `${succeeded.length} 通过 · ${failed.length} 异常` : '暂无终态记录'}
          </span>
        </span>
      </div>
      <div className="pl-metric-card">
        <span className="pl-metric-label">平均成功耗时</span>
        <span className="pl-metric-value">
          {formatDurationSeconds(avgDuration)}
          <span className="pl-metric-sub">{durations.length > 0 ? `近 ${durations.length} 次` : '待统计'}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * 在“全部工作流”视图下醒目展示存在解析错误的工作流，避免错误被折叠进目录项里无法察觉。
 * @param props 解析失败的工作流列表与定位回调。
 * @returns 解析错误摘要区；无错误时不渲染。
 */
export function InvalidWorkflowsBanner({
  invalidWorkflows,
  onSelectWorkflow,
}: {
  invalidWorkflows: PipelineWorkflowSummary[]
  onSelectWorkflow: (path: string) => void
}) {
  if (invalidWorkflows.length === 0) return null
  return (
    <section aria-label="解析错误" className="pl-parse-errors">
      {invalidWorkflows.map((wf) => (
        <div key={wf.path} className="pl-parse-error-item">
          <AlertCircle size={16} className="pl-tone-danger pl-icon" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="pl-parse-error-meta">
                <strong className="text-foreground">{wf.name ?? wf.path}</strong>
                <span className="mono">{wf.path}</span>
                <Badge variant="destructive">解析失败</Badge>
                <Badge variant="outline">不可触发</Badge>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => onSelectWorkflow(wf.path)}>
                定位错误
              </Button>
            </div>
            {wf.parseErrors.map((err, index) => (
              <p key={`${err.code}-${index}`} className="text-xs text-foreground">
                <span className="mono text-muted-foreground">{parseErrorLocation(err)}</span>：{err.message}
              </p>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
