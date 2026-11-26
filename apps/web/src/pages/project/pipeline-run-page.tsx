import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Copy,
  FileCode2,
  GitBranch,
  Package,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Terminal,
  User,
} from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { useSession } from '@/features/identity/model/session'
import { GitHubAccountButton } from '@/features/identity/ui/github-account'
import { ArtifactList } from '@/features/pipeline/ui/artifact-list'
import { CancelRunDialog } from '@/features/pipeline/ui/cancel-run-dialog'
import {
  PipelineRunStatusBadge,
  PipelineStatusIcon,
  stepDisplayStatusLabel,
} from '@/features/pipeline/ui/pipeline-status-icon'
import { RunDetailConsole } from '@/features/pipeline/ui/run-detail-console'
import { TriggerRunDialog } from '@/features/pipeline/ui/trigger-run-dialog'
import { cancelPipelineRun, pipelineRunQueryOptions, triggerPipelineRun } from '@/features/pipeline/api/runs'
import { pipelineWorkflowsQueryOptions } from '@/features/pipeline/api/workflows'
import {
  formatCompactDuration,
  formatDurationSeconds,
  resolveStepDisplayStatus,
  runDurationSeconds,
  shortCommitSha,
  stepDurationSeconds,
} from '@/features/pipeline/lib/format'
import { canCancelRunStatus, isRunActive, isTerminalRunStatus } from '@/features/pipeline/lib/status'
import { useFocusReturn } from '@/features/pipeline/hooks/use-focus-return'
import { usePipelineLogs } from '@/features/pipeline/hooks/use-pipeline-logs'
import type { PipelineRunDetail, PipelineStepDisplayStatus, TriggerRunInput } from '@/features/pipeline/model/types'
import { PipelineRunPageSkeleton } from '@/pages/page-skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { PageError } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import '@/features/pipeline/ui/pipeline.css'

type DetailTab = 'logs' | 'artifacts' | 'snapshot'

/** 根据作业内步骤状态推导作业整体状态。 */
function deriveJobStatus(statuses: PipelineStepDisplayStatus[]): PipelineStepDisplayStatus {
  if (statuses.some((s) => s === 'failed')) return 'failed'
  if (statuses.some((s) => s === 'interrupted')) return 'interrupted'
  if (statuses.some((s) => s === 'running')) return 'running'
  if (statuses.length > 0 && statuses.every((s) => s === 'succeeded')) return 'succeeded'
  if (statuses.some((s) => s === 'cancelled')) return 'cancelled'
  if (statuses.length > 0 && statuses.every((s) => s === 'skipped')) return 'skipped'
  return 'pending'
}

/** 构造状态提示横幅文案；用于中断、失败、取消中、排队等异常与过程说明。 */
function describeStatusAlert(detail: PipelineRunDetail): {
  title: string
  description: string
  variant: 'default' | 'destructive'
} | null {
  if (detail.status === 'cancelling') {
    return {
      title: '取消请求已发出',
      description: '已向执行节点发送取消信号，正在等待节点停止作业并确认最终状态；已发生的外部副作用无法撤回。',
      variant: 'default',
    }
  }
  if (detail.status === 'interrupted') {
    return {
      title: '运行已中断',
      description: detail.errorMessage ?? '执行节点失联或租约过期，运行未能正常完成。',
      variant: 'destructive',
    }
  }
  if (detail.status === 'failed') {
    return {
      title: '运行失败',
      description: detail.errorMessage ?? '部分步骤执行失败，请展开失败步骤查看控制台输出。',
      variant: 'destructive',
    }
  }
  if (detail.status === 'cancelled' && detail.errorMessage) {
    return {
      title: '运行已取消',
      description: detail.errorMessage,
      variant: 'default',
    }
  }
  if (detail.status === 'queued') {
    return {
      title: '正在排队等待执行节点',
      description: '平台已固定工作流快照与提交，待匹配能力标签的在线节点空闲后将自动领取执行。',
      variant: 'default',
    }
  }
  return null
}

/**
 * 流水线运行详情页。
 *
 * 采用紧凑单行元信息条 + 顶部水平执行过程图 + 左侧步骤导航树 + 右侧手风琴暗色日志终端布局，
 * 支持 URL `?step=` 直达步骤、运行产物下载、固定工作流快照查阅、取消与重新运行。
 * @returns 运行详情界面；加载失败可重试。
 */
export function Component() {
  const { projectId = '', runId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { role } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const initialStepParam = searchParams.get('step')
  const urlStepIndex = initialStepParam !== null && /^\d+$/.test(initialStepParam) ? Number(initialStepParam) : null

  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(urlStepIndex)
  const [selectedJobId, setSelectedJobId] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<DetailTab>('logs')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [rerunOpen, setRerunOpen] = useState(false)
  const [copiedSha, setCopiedSha] = useState(false)
  const cancelFocus = useFocusReturn()
  const rerunFocus = useFocusReturn()

  const run = useQuery(pipelineRunQueryOptions(runId))
  const workflows = useQuery({
    ...pipelineWorkflowsQueryOptions(projectId),
    enabled: rerunOpen && Boolean(projectId),
  })
  const detail = run.data?.run

  // 优先聚焦 URL 指定步骤，否则自动聚焦执行中/失败/中断步骤或首个有日志的步骤。
  const defaultLogStepIndex = useMemo(() => {
    if (!detail) return null
    const running = detail.steps.find((step) => step.status === 'running')
    if (running) return running.index
    const failed = detail.steps.find((step) => step.status === 'failed')
    if (failed) return failed.index
    const firstWithLogs = detail.logs.find((stat) => stat.chunkCount > 0)?.stepIndex
    if (firstWithLogs !== undefined) return firstWithLogs
    return detail.steps[0]?.index ?? null
  }, [detail])

  const activeStepIndex = selectedStepIndex ?? defaultLogStepIndex
  const activeRun = detail ? isRunActive(detail.status) : false
  const logs = usePipelineLogs(runId, activeStepIndex, activeRun)

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelPipelineRun(runId, reason),
    onSuccess: async (result) => {
      queryClient.setQueryData(pipelineRunQueryOptions(runId).queryKey, result)
      await queryClient.invalidateQueries({ queryKey: ['pipeline', 'runs'] })
      showToast('已提交取消请求，正在等待执行节点确认。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const rerun = useMutation({
    mutationFn: (input: TriggerRunInput) => triggerPipelineRun(projectId, input),
    onSuccess: async (result) => {
      setRerunOpen(false)
      rerunFocus.restore()
      await queryClient.invalidateQueries({ queryKey: ['pipeline', 'runs', projectId] })
      showToast(`已创建新运行：${result.run.runId.slice(0, 8)}`, 'success')
      navigate(`/projects/${projectId}/pipelines/${result.run.runId}`)
    },
    onError: (error: unknown) => {
      if (
        !isBusinessError(error, 'GITHUB_ACCOUNT_REQUIRED') &&
        !isBusinessError(error, 'GITHUB_REPOSITORY_FORBIDDEN')
      ) {
        showToast(describeRequestError(error).description, 'error')
      }
    },
  })

  if (run.isPending) return <PipelineRunPageSkeleton />
  if (run.isError || !detail) {
    const described = describeRequestError(run.error)
    return (
      <div className="project-tab-panel">
        <PageError
          title="运行详情加载失败"
          description={described.description}
          requestId={described.requestId}
          retrying={run.isFetching}
          onRetry={() => void run.refetch()}
        />
      </div>
    )
  }

  const canOperate = role === 'admin' || role === 'developer'
  const workflowTitle = detail.workflowName ?? detail.workflowPath
  const totalDuration = runDurationSeconds(detail)
  const inputEntries = Object.entries(detail.inputs)
  const statusAlert = describeStatusAlert(detail)
  const validWorkflows = (workflows.data?.items ?? []).filter((item) => item.valid)
  const fallbackWorkflowList =
    validWorkflows.length > 0
      ? validWorkflows
      : [
          {
            path: detail.workflowPath,
            name: detail.workflowName,
            valid: true,
            parseErrors: [],
            runsOn: [],
            jobCount: detail.planJobs.length,
            stepCount: detail.steps.length,
            inputCount: inputEntries.length,
            timeoutMinutes: null,
            recentStatuses: [detail.status],
            lastRun: null,
          },
        ]

  const copyCommitSha = async () => {
    try {
      await navigator.clipboard.writeText(detail.commitSha)
      setCopiedSha(true)
      showToast(`已复制提交 SHA：${detail.commitSha.slice(0, 12)}`, 'success')
      setTimeout(() => setCopiedSha(false), 1600)
    } catch {
      showToast('剪贴板不可用，请手动复制提交 SHA。', 'error')
    }
  }

  const stepByIndex = new Map(detail.steps.map((step) => [step.index, step]))
  const requiresGitHubAccount = isBusinessError(rerun.error, 'GITHUB_ACCOUNT_REQUIRED')
  const lacksGitHubReadAccess = isBusinessError(rerun.error, 'GITHUB_REPOSITORY_FORBIDDEN')
  const rerunError = lacksGitHubReadAccess
    ? '请向仓库管理员申请读取权限，授权后重新触发流水线。'
    : rerun.isError
      ? describeRequestError(rerun.error).description
      : null

  return (
    <div className="project-tab-panel">
      <div className="pl-detail-root">
        <header className="pl-detail-header">
          <div className="pl-detail-title-wrap">
            <nav className="pl-detail-breadcrumb" aria-label="流水线运行面包屑">
              <Link className="pl-detail-back-link" to={`/projects/${projectId}/pipelines`}>
                <ArrowLeft size={14} aria-hidden="true" />
                流水线
              </Link>
              <span>/</span>
              <span>{workflowTitle}</span>
              <span>/</span>
              <span className="mono" title={detail.runId}>
                运行 {detail.runId.slice(0, 8)}
              </span>
            </nav>

            <div className="pl-detail-title-line">
              <PipelineRunStatusBadge status={detail.status} />
              <h1>{workflowTitle}</h1>
              <span className="pl-run-num mono" title={detail.workflowPath}>
                {detail.workflowPath}
              </span>
            </div>
          </div>

          <div className="pl-detail-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void run.refetch()}
              disabled={run.isFetching}
            >
              <RefreshCw size={14} className={run.isFetching ? 'pl-spin' : undefined} aria-hidden="true" />
              刷新
            </Button>

            {canOperate && canCancelRunStatus(detail.status) ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={cancel.isPending}
                onClick={(event) => {
                  cancelFocus.capture(event.currentTarget)
                  setCancelOpen(true)
                }}
              >
                <Square size={13} aria-hidden="true" />
                取消运行
              </Button>
            ) : null}

            {canOperate && isTerminalRunStatus(detail.status) ? (
              <Button
                type="button"
                size="sm"
                onClick={(event) => {
                  rerunFocus.capture(event.currentTarget)
                  rerun.reset()
                  setRerunOpen(true)
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                重新运行
              </Button>
            ) : null}
          </div>
        </header>

        <div className="pl-meta-strip" aria-label="运行关键元信息">
          <div className="pl-meta-cell">
            <span className="pl-meta-cell-label">分支 / 固定提交</span>
            <span className="pl-meta-cell-value">
              <GitBranch size={13} className="text-muted-foreground pl-icon" aria-hidden="true" />
              <span className="mono pl-meta-truncate" title={detail.ref}>
                {detail.ref}
              </span>
              <span className="text-muted-foreground pl-meta-nowrap">·</span>
              <span className="mono pl-meta-nowrap" title={detail.commitSha}>
                {shortCommitSha(detail.commitSha)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="复制完整提交 SHA"
                onClick={() => void copyCommitSha()}
              >
                {copiedSha ? <Check size={12} className="pl-tone-success" /> : <Copy size={12} />}
              </Button>
            </span>
          </div>

          <div className="pl-meta-cell">
            <span className="pl-meta-cell-label">发起人 / 触发方式</span>
            <span className="pl-meta-cell-value">
              <User size={13} className="text-muted-foreground pl-icon" aria-hidden="true" />
              <span className="pl-meta-truncate">
                {detail.initiator} · {detail.triggerSource === 'manual' ? '手动' : detail.triggerSource}（
                {detail.initiatorChannel}）
              </span>
            </span>
          </div>

          <div className="pl-meta-cell">
            <span className="pl-meta-cell-label">执行节点</span>
            <span className="pl-meta-cell-value">
              <Server size={13} className="text-muted-foreground pl-icon" aria-hidden="true" />
              <span className="pl-meta-truncate">{detail.nodeName ?? '等待节点分配'}</span>
            </span>
          </div>

          <div className="pl-meta-cell">
            <span className="pl-meta-cell-label">开始时间 / 总耗时</span>
            <span className="pl-meta-cell-value">
              <Clock size={13} className="text-muted-foreground pl-icon" aria-hidden="true" />
              <span className="pl-meta-truncate">
                {detail.startedAt ? formatDateTime(detail.startedAt) : '尚未开始'} ·{' '}
                {formatDurationSeconds(totalDuration)}
              </span>
            </span>
          </div>

          <div className="pl-meta-cell">
            <span className="pl-meta-cell-label">触发输入参数</span>
            <span className="pl-meta-cell-value">
              {inputEntries.length > 0 ? (
                <span
                  className="mono text-xs pl-meta-truncate"
                  title={inputEntries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
                >
                  {inputEntries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
                </span>
              ) : (
                <span className="text-muted-foreground">使用默认配置</span>
              )}
            </span>
          </div>
        </div>

        {statusAlert ? (
          <Alert variant={statusAlert.variant}>
            <AlertTriangle size={16} aria-hidden="true" />
            <AlertTitle>{statusAlert.title}</AlertTitle>
            <AlertDescription>{statusAlert.description}</AlertDescription>
          </Alert>
        ) : null}

        {detail.steps.length > 0 ? (
          <section className="pl-graph-card" aria-label="执行过程">
            <div className="pl-graph-header">
              <span className="pl-graph-title">
                执行过程
                <span className="counter">
                  {detail.planJobs.length > 1
                    ? `${detail.planJobs.length} 个阶段 · ${detail.steps.length} 步`
                    : `${detail.steps.length} 个步骤`}
                </span>
              </span>
              {detail.planJobs.length > 1 && selectedJobId !== 'all' ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedJobId('all')}>
                  显示全部阶段
                </Button>
              ) : null}
            </div>

            {detail.planJobs.length > 1 ? (
              <div className="pl-graph-flow">
                {detail.planJobs.map((job, idx) => {
                  const jobSteps = job.stepIndexes
                    .map((stepIdx) => stepByIndex.get(stepIdx))
                    .filter((step): step is NonNullable<typeof step> => Boolean(step))
                  const displayStatuses = jobSteps.map((step) => resolveStepDisplayStatus(step, detail.status))
                  const jobStatus = deriveJobStatus(displayStatuses)
                  const doneCount = displayStatuses.filter((status) => status === 'succeeded').length
                  const isSelected = selectedJobId === job.id

                  return (
                    <div key={job.id} className="pl-job-edge-group">
                      {idx > 0 ? (
                        <span className="pl-graph-edge" aria-hidden="true">
                          <ArrowRight size={16} />
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        className={`pl-job-node ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedJobId(isSelected ? 'all' : job.id)
                          setActiveTab('logs')
                          const firstStep = jobSteps[0]
                          if (!isSelected && firstStep) setSelectedStepIndex(firstStep.index)
                        }}
                      >
                        <span className="pl-job-node-top">
                          <PipelineStatusIcon status={jobStatus} size={15} />
                          <span className="pl-job-node-name">{job.name}</span>
                          <span className="text-xs text-muted-foreground">{stepDisplayStatusLabel(jobStatus)}</span>
                        </span>
                        <progress
                          className={`pl-job-progress ${jobStatus}`}
                          value={doneCount}
                          max={Math.max(1, jobSteps.length)}
                          aria-label={`${job.name} 进度`}
                        />
                        <span className="pl-job-node-meta">
                          <span className="mono">{job.runsOn[0] ?? 'runner'}</span>
                          <span>
                            {doneCount}/{jobSteps.length} 步通过
                          </span>
                        </span>
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="pl-stage-track no-indent" aria-label="步骤时间线">
                {detail.steps.map((step, idx) => {
                  const displayStatus = resolveStepDisplayStatus(step, detail.status)
                  const dur = formatCompactDuration(stepDurationSeconds(step, activeRun))
                  const isFocused = activeStepIndex === step.index && activeTab === 'logs'
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
                      {idx > 0 ? <span className={`pl-stage-connector ${connectorTone}`} /> : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`pl-stage-pill ${displayStatus} ${isFocused ? 'focused' : ''}`}
                        onClick={() => {
                          setActiveTab('logs')
                          setSelectedStepIndex(step.index)
                        }}
                      >
                        <PipelineStatusIcon status={displayStatus} size={13} />
                        <span>
                          {step.index + 1}. {step.name}
                        </span>
                        <span className="pl-stage-dur">{dur || stepDisplayStatusLabel(displayStatus)}</span>
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}

        <div className="pl-subtabs">
          <div className="pl-subtab-list" role="tablist" aria-label="运行详情分区">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              className="pl-subtab"
              aria-selected={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
            >
              <Terminal size={14} aria-hidden="true" />
              执行日志
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              className="pl-subtab"
              aria-selected={activeTab === 'artifacts'}
              onClick={() => setActiveTab('artifacts')}
            >
              <Package size={14} aria-hidden="true" />
              运行产物
              <span className="counter">{detail.artifacts.length}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="tab"
              className="pl-subtab"
              aria-selected={activeTab === 'snapshot'}
              onClick={() => setActiveTab('snapshot')}
            >
              <FileCode2 size={14} aria-hidden="true" />
              工作流快照与参数
            </Button>
          </div>
          {activeTab === 'logs' ? (
            <span className="pb-2 text-xs text-muted-foreground">
              {activeRun ? '运行中 · 自动增量读取日志' : '运行已结束 · 展示完整历史日志'}
            </span>
          ) : null}
        </div>

        {activeTab === 'logs' ? (
          <RunDetailConsole
            runId={detail.runId}
            workflowTitle={workflowTitle}
            runStatus={detail.status}
            isRunActive={activeRun}
            steps={detail.steps}
            planJobs={detail.planJobs}
            selectedJobId={selectedJobId}
            activeStepIndex={activeStepIndex}
            onSelectStep={setSelectedStepIndex}
            chunks={logs.chunks}
            isLogsPending={logs.isPending}
            logsErrorDescription={logs.errorDescription}
            logsRequestId={logs.requestId}
            hasTruncatedContent={logs.hasTruncatedContent}
            onRefreshLogs={logs.refresh}
          />
        ) : null}

        {activeTab === 'artifacts' ? (
          <ArtifactList
            artifacts={detail.artifacts}
            isPending={false}
            errorDescription={null}
            requestId={run.data?.requestId ?? null}
            onRetry={() => void run.refetch()}
            canDownload
          />
        ) : null}

        {activeTab === 'snapshot' ? (
          <div className="space-y-4">
            <div className="pl-wf-facts">
              <span className="pl-wf-fact">
                <span className="pl-wf-fact-label">快照文件</span>
                <span className="mono">{detail.workflowPath}</span>
              </span>
              <span className="pl-wf-fact">
                <span className="pl-wf-fact-label">固定提交</span>
                <span className="mono">{detail.commitSha}</span>
              </span>
            </div>

            {inputEntries.length > 0 ? (
              <div className="table-wrap">
                <Table aria-label="本次运行触发参数">
                  <TableHeader>
                    <TableRow>
                      <TableHead>触发参数名</TableHead>
                      <TableHead>本次运行值</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inputEntries.map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="mono">{key}</TableCell>
                        <TableCell className="mono">{value === null ? '默认' : String(value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {detail.workflowSnapshot ? (
              <div className="pl-yaml-viewer" aria-label="本次运行的工作流 YAML 快照">
                {detail.workflowSnapshot.split('\n').map((line, index) => (
                  <div key={index} className="pl-yaml-line">
                    <span className="pl-yaml-lineno">{index + 1}</span>
                    <span className="pl-yaml-code">{line || ' '}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">该历史运行未保存工作流源码快照。</p>
            )}
          </div>
        ) : null}
      </div>

      <CancelRunDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open)
          if (!open) cancelFocus.restore()
        }}
        runLabel={`${workflowTitle}（${detail.runId.slice(0, 8)}）`}
        isPending={cancel.isPending}
        onConfirm={(reason) => {
          setCancelOpen(false)
          cancelFocus.restore()
          cancel.mutate(reason)
        }}
      />

      <TriggerRunDialog
        projectId={projectId}
        open={rerunOpen}
        onOpenChange={(open) => {
          setRerunOpen(open)
          if (!open) rerunFocus.restore()
        }}
        workflows={fallbackWorkflowList}
        initialWorkflowPath={detail.workflowPath}
        defaultRef={detail.ref}
        onSubmit={(input) => rerun.mutate(input)}
        isSubmitting={rerun.isPending}
        errorMessage={rerunError}
        errorAction={requiresGitHubAccount ? <GitHubAccountButton label="绑定 GitHub 账号" /> : undefined}
      />
    </div>
  )
}

export default Component
