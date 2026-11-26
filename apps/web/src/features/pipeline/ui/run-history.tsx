import { Link } from 'react-router'
import {
  AlertTriangle,
  Clock,
  GitBranch,
  GitCommitHorizontal,
  Play,
  RotateCcw,
  Server,
  Square,
  Terminal,
  User,
} from 'lucide-react'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { CompactListSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { Pagination } from '@/shared/ui/pagination'
import {
  formatCompactDuration,
  formatDurationSeconds,
  hasRunFilters,
  resolveStepDisplayStatus,
  runDurationSeconds,
  shortCommitSha,
  stepDurationSeconds,
} from '../lib/format'
import {
  canCancelRunStatus,
  isPipelineRunStatus,
  isRunActive,
  isTerminalRunStatus,
  RUN_FILTER_STATUSES,
  runStatusLabel,
} from '../lib/status'
import type { PipelineRunFilters, PipelineRunSummary } from '../model/types'
import { PipelineRunStatusBadge, PipelineStatusIcon, stepDisplayStatusLabel } from './pipeline-status-icon'

interface RunHistoryProps {
  /** 当前页运行记录（每条包含步骤摘要用于渲染内嵌阶段进度条）。 */
  runs: PipelineRunSummary[]
  /** 总记录数。 */
  total: number
  /** 当前页码，从 1 开始。 */
  page: number
  /** 每页条数。 */
  pageSize: number
  /** 当前 URL 筛选条件。 */
  filters: PipelineRunFilters
  /** 项目路由前缀，如 /projects/:projectId。 */
  projectBasePath: string
  /** 当前角色是否允许触发/重跑/取消。 */
  canOperate: boolean
  /** 是否有可运行工作流（空状态主动作判断）。 */
  hasValidWorkflows: boolean
  /** 筛选条件变化回调。 */
  onFiltersChange: (next: PipelineRunFilters) => void
  /** 清除所有筛选。 */
  onClearFilters: () => void
  /** 翻页回调。 */
  onPageChange: (page: number) => void
  /** 重新运行回调。 */
  onRerun?: (run: PipelineRunSummary, triggerElement: HTMLElement | null) => void
  /** 取消运行回调。 */
  onCancelRun?: (run: PipelineRunSummary, triggerElement: HTMLElement | null) => void
  /** 空状态触发运行回调。 */
  onTriggerFirst?: (triggerElement: HTMLElement | null) => void
  /** 加载中状态。 */
  isPending: boolean
  /** 加载失败说明；非空时显示错误与重试。 */
  errorDescription: string | null
  /** 失败请求标识。 */
  requestId: string | null
  /** 重试运行列表请求。 */
  onRetry: () => void
}

/**
 * 流水线运行历史卡片流。
 *
 * 在每条运行记录下方直接内嵌 Jenkins Stage View 风格的步骤进度轨道，
 * 点击任意阶段胶囊可直达运行详情并定位该步骤日志；同时支持状态、日期范围筛选与分页。
 * @param props 运行数据、筛选、分页与快捷操作回调。
 * @returns 运行历史筛选栏与卡片列表。
 */
export function RunHistory({
  runs,
  total,
  page,
  pageSize,
  filters,
  projectBasePath,
  canOperate,
  hasValidWorkflows,
  onFiltersChange,
  onClearFilters,
  onPageChange,
  onRerun,
  onCancelRun,
  onTriggerFirst,
  isPending,
  errorDescription,
  requestId,
  onRetry,
}: RunHistoryProps) {
  const filtered = hasRunFilters(filters)
  const hasSecondaryFilters = Boolean(filters.status || filters.from || filters.to)
  const showFilterBar = isPending || errorDescription !== null || total > 0 || filtered

  return (
    <section aria-label="运行历史" className="space-y-3">
      {showFilterBar ? (
        <div className="pl-run-toolbar">
          <Select
            aria-label="按状态筛选"
            className="pl-filter-control"
            value={filters.status}
            onChange={(event) => {
              const value = event.target.value
              onFiltersChange({ ...filters, status: isPipelineRunStatus(value) ? value : '' })
            }}
          >
            <option value="">全部状态</option>
            {RUN_FILTER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {runStatusLabel(status)}
              </option>
            ))}
          </Select>

          <label className="pl-date-field">
            <span>开始日期</span>
            <Input
              aria-label="开始日期"
              type="date"
              className="pl-date-input"
              value={filters.from}
              onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
            />
          </label>

          <label className="pl-date-field">
            <span>结束日期</span>
            <Input
              aria-label="结束日期"
              type="date"
              className="pl-date-input"
              value={filters.to}
              onChange={(event) => onFiltersChange({ ...filters, to: event.target.value })}
            />
          </label>

          {hasSecondaryFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}

      {isPending ? (
        <CompactListSkeleton rows={4} leading="icon" trailing bordered label="运行历史加载中" />
      ) : errorDescription !== null ? (
        <PageError title="运行历史加载失败" description={errorDescription} requestId={requestId} onRetry={onRetry} />
      ) : runs.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Terminal />}
            title="没有匹配的运行"
            description="当前筛选条件下没有找到流水线运行记录，可放宽状态、日期或工作流筛选。"
            action={
              <Button type="button" variant="outline" onClick={onClearFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Terminal />}
            title="还没有运行记录"
            description="在左侧选择任意可运行工作流并触发运行，阶段进度与日志会实时展示在这里。"
            action={
              canOperate && hasValidWorkflows && onTriggerFirst ? (
                <Button type="button" onClick={(event) => onTriggerFirst(event.currentTarget)}>
                  <Play size={14} aria-hidden="true" />
                  发起首次运行
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="pl-run-list" aria-label="流水线运行历史">
            {runs.map((run) => {
              const title = run.workflowName ?? run.workflowPath
              const active = isRunActive(run.status)
              const duration = runDurationSeconds(run)
              const detailHref = `${projectBasePath}/pipelines/${run.runId}`
              const doneSteps = run.steps.filter((s) => s.status === 'succeeded').length

              return (
                <article
                  key={run.runId}
                  className={`pl-run-card ${run.status === 'running' ? 'is-running' : ''} ${
                    run.status === 'failed' || run.status === 'interrupted' ? 'is-failed' : ''
                  }`}
                >
                  <div className="pl-run-head">
                    <div className="pl-run-title-group">
                      <span className="pl-run-title-icon" title={runStatusLabel(run.status)}>
                        <PipelineStatusIcon status={run.status} size={17} />
                      </span>
                      <div className="pl-run-title-body">
                        <div className="pl-run-title-row">
                          <Link className="pl-run-title-link" to={detailHref}>
                            {title}
                          </Link>
                          <span className="pl-run-num mono" title={run.runId}>
                            #{run.runId.slice(0, 8)}
                          </span>
                          <PipelineRunStatusBadge status={run.status} />
                          {run.steps.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {doneSteps}/{run.steps.length} 步
                            </span>
                          ) : null}
                        </div>

                        <div className="pl-run-meta-row">
                          <span className="pl-meta-pill branch">
                            <GitBranch size={11} aria-hidden="true" />
                            {run.ref}
                          </span>
                          <span className="inline-flex items-center gap-1 mono" title={run.commitSha}>
                            <GitCommitHorizontal size={13} aria-hidden="true" />
                            {shortCommitSha(run.commitSha)}
                          </span>
                          {run.nodeName ? (
                            <span className="inline-flex items-center gap-1">
                              <Server size={12} aria-hidden="true" />
                              {run.nodeName}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1">
                            <User size={12} aria-hidden="true" />
                            {run.initiator}
                          </span>
                          <span title={formatDateTime(run.createdAt)}>{formatRelativeTime(run.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pl-run-right">
                      <div className="pl-run-timing">
                        <span className="pl-run-duration">
                          <Clock size={12} aria-hidden="true" />
                          {formatDurationSeconds(duration)}
                        </span>
                        <span>{run.triggerSource === 'manual' ? '手动触发' : run.triggerSource}</span>
                      </div>

                      {canOperate && canCancelRunStatus(run.status) && onCancelRun ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(event) => onCancelRun(run, event.currentTarget)}
                        >
                          <Square size={12} aria-hidden="true" />
                          取消
                        </Button>
                      ) : null}

                      {canOperate && isTerminalRunStatus(run.status) && onRerun ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(event) => onRerun(run, event.currentTarget)}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          重跑
                        </Button>
                      ) : null}

                      <Button asChild variant="outline" size="sm">
                        <Link to={detailHref}>查看日志</Link>
                      </Button>
                    </div>
                  </div>

                  {run.steps.length > 0 ? (
                    <div className="pl-stage-track" aria-label="步骤执行进度">
                      {run.steps.map((step, index) => {
                        const displayStatus = resolveStepDisplayStatus(step, run.status)
                        const stepDur = formatCompactDuration(stepDurationSeconds(step, active))
                        const connectorTone =
                          displayStatus === 'succeeded'
                            ? 'done'
                            : displayStatus === 'running'
                              ? 'active'
                              : displayStatus === 'failed' || displayStatus === 'interrupted'
                                ? 'error'
                                : ''
                        return (
                          <div key={step.index} className="pl-stage-item">
                            {index > 0 ? <span className={`pl-stage-connector ${connectorTone}`} /> : null}
                            <Link
                              to={`${detailHref}?step=${step.index}`}
                              className={`pl-stage-pill ${displayStatus}`}
                              title={`${step.index + 1}. ${step.name} · ${stepDisplayStatusLabel(displayStatus)}`}
                            >
                              <PipelineStatusIcon status={displayStatus} size={13} />
                              <span>
                                {step.index + 1}. {step.name}
                              </span>
                              <span className="pl-stage-dur">{stepDur || stepDisplayStatusLabel(displayStatus)}</span>
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}

                  {run.errorMessage ? (
                    <div className={`pl-run-error-line ${run.status === 'queued' ? 'warning' : ''}`} role="note">
                      <AlertTriangle size={14} className="pl-icon" aria-hidden="true" />
                      <span>
                        {run.errorCode ? <strong className="mono">[{run.errorCode}] </strong> : null}
                        {run.errorMessage}
                      </span>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />
        </>
      )}
    </section>
  )
}
