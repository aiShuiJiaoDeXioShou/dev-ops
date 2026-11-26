import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Copy, Download, RefreshCw, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { LogLinesSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import {
  formatCompactDuration,
  formatDurationSeconds,
  resolveStepDisplayStatus,
  stepDurationSeconds,
  stepKindLabel,
} from '../lib/format'
import type { PipelineLogChunk, PipelineRunPlanJob, PipelineRunStatus, PipelineRunStep } from '../model/types'
import { PipelineStatusIcon, stepDisplayStatusLabel } from './pipeline-status-icon'

interface RunDetailConsoleProps {
  /** 运行标识与名称，用于日志导出文件名。 */
  runId: string
  workflowTitle: string
  runStatus: PipelineRunStatus
  /** 是否运行中；决定耗时计算与实时轮询文案。 */
  isRunActive: boolean
  /** 全部步骤列表。 */
  steps: PipelineRunStep[]
  /** 作业分组；单作业或缺失时自动合并为一个分组。 */
  planJobs: PipelineRunPlanJob[]
  /** 当前筛选的作业 ID；'all' 显示全部。 */
  selectedJobId: string
  /** 当前聚焦并读取日志的步骤序号。 */
  activeStepIndex: number | null
  /** 切换当前聚焦步骤。 */
  onSelectStep: (stepIndex: number) => void
  /** 当前步骤的日志分片。 */
  chunks: PipelineLogChunk[]
  /** 当前步骤日志是否加载中。 */
  isLogsPending: boolean
  /** 日志加载失败说明。 */
  logsErrorDescription: string | null
  /** 日志请求标识。 */
  logsRequestId: string | null
  /** 日志是否因上限被截断。 */
  hasTruncatedContent: boolean
  /** 手动重新读取当前步骤日志。 */
  onRefreshLogs: () => void
}

/** 将日志文本按行分类，用于在终端中用语义色突出命令、警告与错误。 */
function classifyLogLine(line: string): 'cmd' | 'error' | 'warn' | 'success' | 'info' {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('$ ') || trimmed.startsWith('> ')) return 'cmd'
  if (/(\bERR_[A-Z0-9_]+|\bERROR\b|error:|fatal:|failed|FAIL\b)/i.test(trimmed)) return 'error'
  if (/(\bWARN\b|warning:|deprecated)/i.test(trimmed)) return 'warn'
  if (/(^✓|passed|succeeded|done in)/i.test(trimmed)) return 'success'
  return 'info'
}

/** 把步骤分组为左侧树与右侧手风琴所需的作业结构。 */
function groupStepsByJob(
  steps: PipelineRunStep[],
  planJobs: PipelineRunPlanJob[],
  selectedJobId: string,
): Array<{ id: string; name: string; steps: PipelineRunStep[] }> {
  if (planJobs.length === 0) {
    return [{ id: 'default', name: '执行步骤', steps }]
  }
  const stepMap = new Map(steps.map((step) => [step.index, step]))
  const assigned = new Set<number>()
  const groups = planJobs
    .map((job) => {
      const jobSteps = job.stepIndexes
        .map((idx) => {
          assigned.add(idx)
          return stepMap.get(idx)
        })
        .filter((step): step is PipelineRunStep => Boolean(step))
      return { id: job.id, name: job.name, steps: jobSteps }
    })
    .filter((group) => group.steps.length > 0)

  const unassigned = steps.filter((step) => !assigned.has(step.index))
  if (unassigned.length > 0) groups.push({ id: 'other', name: '其他步骤', steps: unassigned })
  if (selectedJobId === 'all') return groups
  const matched = groups.filter((group) => group.id === selectedJobId)
  return matched.length > 0 ? matched : groups
}

/**
 * 运行详情的步骤导航树 + 内嵌暗色终端日志工作台。
 *
 * 左侧列出按 Job 分组的步骤目录，右侧以手风琴形式呈现每个步骤并在当前聚焦步骤正下方实时流式展示暗色等宽日志，
 * 支持日志关键字过滤、步骤快速切换、复制与导出。
 * @param props 步骤、作业分组、当前聚焦步骤及日志状态。
 * @returns 双栏步骤与日志工作区。
 */
export function RunDetailConsole({
  runId,
  workflowTitle,
  runStatus,
  isRunActive,
  steps,
  planJobs,
  selectedJobId,
  activeStepIndex,
  onSelectStep,
  chunks,
  isLogsPending,
  logsErrorDescription,
  logsRequestId,
  hasTruncatedContent,
  onRefreshLogs,
}: RunDetailConsoleProps) {
  const { showToast } = useToast()
  const [logQuery, setLogQuery] = useState('')
  const [collapsedActive, setCollapsedActive] = useState(false)

  const groups = useMemo(() => groupStepsByJob(steps, planJobs, selectedJobId), [steps, planJobs, selectedJobId])
  const visibleSteps = useMemo(() => groups.flatMap((group) => group.steps), [groups])

  const logLines = useMemo(() => {
    const raw = chunks.map((chunk) => chunk.content).join('')
    if (!raw) return []
    const lines = raw.replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    return lines
  }, [chunks])

  const filteredLines = useMemo(() => {
    const query = logQuery.trim().toLowerCase()
    if (!query) return logLines.map((text, index) => ({ lineNumber: index + 1, text }))
    return logLines
      .map((text, index) => ({ lineNumber: index + 1, text }))
      .filter((item) => item.text.toLowerCase().includes(query))
  }, [logLines, logQuery])

  const selectAndOpenStep = (stepIndex: number) => {
    if (stepIndex === activeStepIndex) {
      setCollapsedActive((prev) => !prev)
      return
    }
    setCollapsedActive(false)
    onSelectStep(stepIndex)
  }

  const copyLogs = async () => {
    const text = logLines.join('\n')
    if (!text) {
      showToast('当前步骤暂无可复制的日志。', 'info')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制当前步骤日志。', 'success')
    } catch {
      showToast('剪贴板不可用，请手动选择日志文本复制。', 'error')
    }
  }

  const exportLogs = () => {
    const text = logLines.join('\n')
    if (!text) {
      showToast('当前步骤暂无可导出的日志。', 'info')
      return
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${workflowTitle}-${runId.slice(0, 8)}-step-${(activeStepIndex ?? 0) + 1}.log`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  if (steps.length === 0) {
    return (
      <div className="pl-log-empty">
        {isRunActive ? '运行已创建，等待执行节点领取租约并初始化步骤…' : '本次运行没有记录步骤信息。'}
      </div>
    )
  }

  return (
    <div className="pl-log-workspace">
      <aside className="pl-step-nav" aria-label="步骤目录">
        {groups.map((group) => (
          <div key={group.id} className="pl-step-nav-group">
            <div className="pl-step-nav-group-title">
              <span>{group.name}</span>
              <span className="mono">{group.steps.length} 步</span>
            </div>
            {group.steps.map((step) => {
              const displayStatus = resolveStepDisplayStatus(step, runStatus)
              const dur = formatCompactDuration(stepDurationSeconds(step, isRunActive))
              const isSelected = activeStepIndex === step.index
              return (
                <Button
                  key={step.index}
                  type="button"
                  variant="ghost"
                  className={`pl-step-nav-item ${isSelected ? 'active' : ''}`}
                  aria-current={isSelected ? 'step' : undefined}
                  onClick={() => {
                    setCollapsedActive(false)
                    onSelectStep(step.index)
                  }}
                >
                  <PipelineStatusIcon status={displayStatus} size={14} />
                  <span className="pl-step-nav-name">
                    {step.index + 1}. {step.name}
                  </span>
                  <span className="pl-step-nav-dur">{dur || stepDisplayStatusLabel(displayStatus)}</span>
                </Button>
              )
            })}
          </div>
        ))}
      </aside>

      <section className="pl-console-pane" aria-label="步骤执行日志">
        <div className="pl-console-toolbar">
          <div className="pl-console-search-wrap">
            <Search size={13} className="pl-console-search-icon" aria-hidden="true" />
            <Input
              aria-label="在日志中搜索"
              className="pl-console-search-input"
              placeholder="搜索当前步骤日志…"
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
            />
          </div>

          <Select
            aria-label="按步骤筛选日志"
            className="pl-console-step-select"
            value={activeStepIndex !== null ? String(activeStepIndex) : ''}
            onChange={(event) => {
              setCollapsedActive(false)
              onSelectStep(Number(event.target.value))
            }}
          >
            {steps.map((step) => (
              <option key={step.index} value={step.index}>
                {step.index + 1}. {step.name}
              </option>
            ))}
          </Select>

          <div className="pl-console-actions">
            <Button type="button" variant="outline" size="sm" onClick={onRefreshLogs}>
              <RefreshCw size={12} aria-hidden="true" />
              重新读取
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyLogs()}>
              <Copy size={12} aria-hidden="true" />
              复制
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={exportLogs}>
              <Download size={12} aria-hidden="true" />
              导出
            </Button>
          </div>
        </div>

        <div className="pl-accordion-list">
          {visibleSteps.map((step) => {
            const isSelected = activeStepIndex === step.index
            const isExpanded = isSelected && !collapsedActive
            const displayStatus = resolveStepDisplayStatus(step, runStatus)
            const duration = stepDurationSeconds(step, isRunActive)

            return (
              <div
                key={step.index}
                className={`pl-step-accordion ${isExpanded ? 'is-expanded' : ''} ${isSelected ? 'is-focused' : ''}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="pl-step-accordion-trigger"
                  aria-expanded={isExpanded}
                  onClick={() => selectAndOpenStep(step.index)}
                >
                  <ChevronRight size={14} className="pl-step-acc-chevron" aria-hidden="true" />
                  <PipelineStatusIcon status={displayStatus} size={15} />
                  <span className="pl-step-acc-title">
                    {step.index + 1}. {step.name}
                  </span>
                  <span className="pl-step-acc-meta">
                    <Badge variant="outline">{stepKindLabel(step.kind)}</Badge>
                    {step.exitCode !== null ? (
                      <Badge variant={step.exitCode === 0 ? 'secondary' : 'destructive'} className="mono">
                        退出码：{step.exitCode}
                      </Badge>
                    ) : null}
                    <span className="mono">
                      {duration !== null ? formatDurationSeconds(duration) : stepDisplayStatusLabel(displayStatus)}
                    </span>
                  </span>
                </Button>

                {isExpanded ? (
                  <div>
                    {step.errorMessage ? (
                      <div className="pl-step-error-box" role="note">
                        <AlertTriangle size={14} className="pl-icon" aria-hidden="true" />
                        <span>
                          {step.errorCode ? <strong className="mono">[{step.errorCode}] </strong> : null}
                          {step.errorMessage}
                        </span>
                      </div>
                    ) : null}

                    {hasTruncatedContent ? (
                      <div className="p-3">
                        <Alert>
                          <AlertTitle>日志已截断</AlertTitle>
                          <AlertDescription>日志内容超过单步骤或页面显示上限，仅保留已采集片段。</AlertDescription>
                        </Alert>
                      </div>
                    ) : null}

                    {logsErrorDescription !== null && logLines.length === 0 ? (
                      <div className="p-4">
                        <PageError
                          title="日志读取失败"
                          description={logsErrorDescription}
                          requestId={logsRequestId}
                          onRetry={onRefreshLogs}
                        />
                      </div>
                    ) : isLogsPending && logLines.length === 0 ? (
                      <div className="p-4">
                        <LogLinesSkeleton lines={6} label="日志加载中" />
                      </div>
                    ) : filteredLines.length > 0 ? (
                      <div className="pl-terminal-body" role="log" aria-label={`${step.name} 日志`}>
                        {filteredLines.map((line) => (
                          <div key={line.lineNumber} className={`pl-log-line ${classifyLogLine(line.text)}`}>
                            <span className="pl-log-lineno">{line.lineNumber}</span>
                            <span className="pl-log-text">{line.text || ' '}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="pl-log-empty">
                        {logQuery.trim()
                          ? `当前步骤中没有匹配「${logQuery}」的日志行。`
                          : displayStatus === 'pending'
                            ? '步骤尚未开始，将在前置步骤完成后输出日志。'
                            : displayStatus === 'skipped'
                              ? '上游步骤未通过，已跳过此步骤。'
                              : isRunActive
                                ? '等待执行节点上传日志…'
                                : '该步骤没有产生日志输出。'}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
