import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Clock,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  User,
} from 'lucide-react'
import { ProtoButton, ProtoEmpty, ProtoSearch } from '@/prototype/components/proto-controls'
import { usePrototype } from '@/prototype/data/store'
import {
  countRunStepProgress,
  flattenRunSteps,
  initialProtoPipelineRuns,
  protoPipelineNodes,
  protoPipelineRefs,
  protoPipelineWorkflows,
  type ProtoPipelineRun,
  type ProtoPipelineRunStatus,
  type ProtoPipelineWorkflow,
} from '@/prototype/data/pipelines'
import {
  formatCompactDuration,
  formatProtoDuration,
  getRunStatusMeta,
  getStepStatusMeta,
  isProtoRunActive,
  PipelineStatusIcon,
} from './pipeline-status'
import { PipelineRunDetailView } from './pipeline-run-detail'
import { PipelineNodesOverviewDialog, TriggerPipelineDialog, WorkflowDefinitionDialog } from './pipeline-dialogs'
import './pipelines.css'

type StatusFilter = 'all' | 'active' | 'succeeded' | 'failed' | 'other'

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败 / 中断' },
  { value: 'other', label: '已取消' },
]

/**
 * 按筛选标签匹配运行状态。
 * @param status 运行状态。
 * @param filter 当前筛选值。
 * @returns 是否满足筛选条件。
 */
function matchesStatusFilter(status: ProtoPipelineRunStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return isProtoRunActive(status)
  if (filter === 'succeeded') return status === 'succeeded'
  if (filter === 'failed') return status === 'failed' || status === 'interrupted'
  return status === 'cancelled'
}

/**
 * 渲染重塑后的内置流水线工作台原型。
 *
 * 采用 GitHub Actions 左侧工作流目录 + 右侧运行列表的主从架构，
 * 并在每条运行记录中内嵌 Jenkins Stage View 风格的阶段进度轨道，
 * 点击任意阶段可直接跳转运行详情并定位到该步骤日志。
 * @returns 流水线主工作台或运行详情视图。
 */
export function PipelinesPage() {
  const { currentProject, currentRole, showToast } = usePrototype()
  const [searchParams, setSearchParams] = useSearchParams()

  const projectRefs = protoPipelineRefs[currentProject.id] ?? protoPipelineRefs['dev-ops'] ?? []
  const [selectedRef, setSelectedRef] = useState(projectRefs[0]?.ref ?? 'main')
  const [runs, setRuns] = useState<ProtoPipelineRun[]>(() =>
    initialProtoPipelineRuns.filter((run) => run.projectId === currentProject.id),
  )
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [branchFilter, setBranchFilter] = useState<string>('')
  const [query, setQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [inspectWorkflow, setInspectWorkflow] = useState<ProtoPipelineWorkflow | null>(null)
  const [triggerOpen, setTriggerOpen] = useState(false)
  const [triggerInitialPath, setTriggerInitialPath] = useState('')
  const [nodesDialogOpen, setNodesDialogOpen] = useState(false)

  const workflows = useMemo(
    () => protoPipelineWorkflows.filter((wf) => wf.projectId === currentProject.id),
    [currentProject.id],
  )
  const validWorkflows = useMemo(() => workflows.filter((wf) => wf.valid), [workflows])
  const canOperate = currentRole !== '浏览者'

  const selectedWorkflowPath = searchParams.get('workflow') ?? ''
  const selectedRunId = searchParams.get('run') ?? ''
  const initialStepParam = searchParams.get('step')
  const initialStepIndex =
    initialStepParam !== null && !Number.isNaN(Number(initialStepParam)) ? Number(initialStepParam) : null

  useEffect(() => {
    const nextRefs = protoPipelineRefs[currentProject.id] ?? protoPipelineRefs['dev-ops'] ?? []
    setSelectedRef(nextRefs[0]?.ref ?? 'main')
    setRuns(initialProtoPipelineRuns.filter((run) => run.projectId === currentProject.id))
    setStatusFilter('all')
    setBranchFilter('')
    setQuery('')
  }, [currentProject.id])

  const activeWorkflow = workflows.find((wf) => wf.path === selectedWorkflowPath) ?? null
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
  const activeRefMeta = projectRefs.find((item) => item.ref === selectedRef) ?? projectRefs[0]

  const onlineNodes = protoPipelineNodes.filter((node) => node.status !== 'offline')

  const updateParams = (patch: { workflow?: string | null; run?: string | null; step?: number | null }) => {
    const next = new URLSearchParams(searchParams)
    if (patch.workflow !== undefined) {
      if (patch.workflow) next.set('workflow', patch.workflow)
      else next.delete('workflow')
    }
    if (patch.run !== undefined) {
      if (patch.run) next.set('run', patch.run)
      else next.delete('run')
    }
    if (patch.step !== undefined) {
      if (patch.step !== null) next.set('step', String(patch.step))
      else next.delete('step')
    }
    setSearchParams(next)
  }

  const filteredRuns = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return runs.filter((run) => {
      if (selectedWorkflowPath && run.workflowPath !== selectedWorkflowPath) return false
      if (!matchesStatusFilter(run.status, statusFilter)) return false
      if (branchFilter && run.ref !== branchFilter) return false
      if (!keyword) return true
      return `#${run.runNumber} ${run.shortId} ${run.workflowName} ${run.commitMessage} ${run.ref} ${run.initiator}`
        .toLowerCase()
        .includes(keyword)
    })
  }, [runs, selectedWorkflowPath, statusFilter, branchFilter, query])

  const openTriggerModal = (workflow?: ProtoPipelineWorkflow) => {
    if (!canOperate) return
    const target = workflow?.valid ? workflow : validWorkflows[0]
    setTriggerInitialPath(target?.path ?? '')
    setTriggerOpen(true)
  }

  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => {
      setIsRefreshing(false)
      showToast(`已重新解析 ${selectedRef} 分支的 ${workflows.length} 个工作流定义`)
    }, 350)
  }

  const createDemoRun = (
    workflow: ProtoPipelineWorkflow,
    ref: string,
    inputs: Record<string, string | number | boolean>,
  ) => {
    const refMeta = projectRefs.find((item) => item.ref === ref) ?? activeRefMeta
    const nextNumber = runs.reduce((max, item) => Math.max(max, item.runNumber), 0) + 1
    const shortId = Math.random().toString(16).slice(2, 10)
    const targetNode = protoPipelineNodes.find(
      (node) => node.status !== 'offline' && workflow.runsOn.some((cap) => node.capabilities.includes(cap)),
    )
    const isQueued = !targetNode

    const jobs = workflow.jobs.map((job, jobIdx) => ({
      id: job.id,
      name: job.name,
      runsOn: job.runsOn,
      needs: job.needs,
      status: isQueued ? ('pending' as const) : jobIdx === 0 ? ('running' as const) : ('pending' as const),
      nodeName: targetNode?.name ?? null,
      durationSeconds: isQueued ? null : jobIdx === 0 ? 4 : null,
      steps: job.steps.map((step, stepIdx) => {
        const runningStep = !isQueued && jobIdx === 0 && stepIdx === 0
        return {
          index: step.index,
          jobId: job.id,
          jobName: job.name,
          name: step.name,
          kind: step.kind,
          status: runningStep ? ('running' as const) : ('pending' as const),
          startedAt: runningStep ? '刚刚' : null,
          finishedAt: null,
          durationSeconds: runningStep ? 4 : null,
          exitCode: null,
          commandPreview: step.commandPreview,
          logs: runningStep
            ? [
                { time: '19:26:01', text: `领取租约：节点 ${targetNode.name} (${job.runsOn})`, level: 'info' as const },
                {
                  time: '19:26:03',
                  text: `$ git fetch --depth=1 origin ${refMeta?.commitSha ?? workflow.commitSha}`,
                  level: 'cmd' as const,
                },
              ]
            : [],
        }
      }),
    }))

    const newRun: ProtoPipelineRun = {
      id: `run-${nextNumber}`,
      runNumber: nextNumber,
      shortId,
      projectId: currentProject.id,
      workflowPath: workflow.path,
      workflowName: workflow.name,
      ref,
      commitSha: refMeta?.commitSha ?? workflow.commitSha,
      commitMessage: refMeta?.commitMessage ?? `手动触发 ${workflow.name}`,
      status: isQueued ? 'queued' : 'running',
      triggerSource: 'manual',
      initiator: '林然',
      initiatorChannel: 'Web 页面',
      nodeName: targetNode?.name ?? null,
      nodeTag: workflow.runsOn[0] ?? 'linux-docker',
      createdAt: '2026/11/26 19:26',
      relativeTime: '刚刚',
      startedAt: isQueued ? null : '2026/11/26 19:26:01',
      finishedAt: null,
      durationSeconds: isQueued ? null : 4,
      inputs,
      errorMessage: isQueued
        ? `当前没有匹配能力标签 ${workflow.runsOn.join(', ')} 的在线执行节点，任务已进入队列等待。`
        : undefined,
      jobs,
      artifacts: [],
      yamlSnapshot: workflow.yamlContent,
    }

    setRuns((current) => [newRun, ...current])
    showToast(isQueued ? `已创建运行 #${nextNumber}（等待匹配节点上线）` : `已触发运行 #${nextNumber}，正在节点执行`)
    updateParams({ run: newRun.id, step: 0 })
  }

  const handleRerun = (run: ProtoPipelineRun) => {
    const wf = workflows.find((item) => item.path === run.workflowPath)
    if (!wf || !wf.valid) {
      showToast('该工作流当前不可触发，请先修复解析错误')
      return
    }
    createDemoRun(wf, run.ref, run.inputs)
  }

  const handleCancelRun = (target: ProtoPipelineRun) => {
    setRuns((current) =>
      current.map((run) => {
        if (run.id !== target.id) return run
        return {
          ...run,
          status: 'cancelled',
          finishedAt: '2026/11/26 19:26:30',
          errorMessage: '已由林然手动取消。已发生的外部部署副作用无法自动撤回。',
          jobs: run.jobs.map((job) => ({
            ...job,
            status: job.status === 'succeeded' ? 'succeeded' : 'cancelled',
            steps: job.steps.map((step) =>
              step.status === 'succeeded'
                ? step
                : {
                    ...step,
                    status: 'cancelled',
                    logs:
                      step.status === 'running'
                        ? [
                            ...step.logs,
                            { time: '19:26:30', text: '收到取消信号，容器已停止。', level: 'warn' as const },
                          ]
                        : step.logs,
                  },
            ),
          })),
        }
      }),
    )
    showToast(`运行 #${target.runNumber} 已取消`)
  }

  const handleAdvanceLive = (runId: string) => {
    setRuns((current) =>
      current.map((run) => {
        if (run.id !== runId || run.status !== 'running') return run
        const flat = flattenRunSteps(run)
        const activeIdx = flat.findIndex((step) => step.status === 'running')
        const currentStep = activeIdx >= 0 ? flat[activeIdx] : undefined
        if (!currentStep) return run
        const nextStep = flat[activeIdx + 1] ?? null

        const nextJobs = run.jobs.map((job) => {
          const updatedSteps = job.steps.map((step) => {
            if (step.index === currentStep.index) {
              return {
                ...step,
                status: 'succeeded' as const,
                exitCode: 0,
                durationSeconds: (step.durationSeconds ?? 10) + 8,
                finishedAt: '2026/11/26 19:26:18',
                logs: [
                  ...step.logs,
                  { time: '19:26:18', text: `✓ 步骤「${step.name}」执行完成（exit 0）`, level: 'success' as const },
                ],
              }
            }
            if (nextStep && step.index === nextStep.index) {
              return {
                ...step,
                status: 'running' as const,
                startedAt: '2026/11/26 19:26:18',
                durationSeconds: 3,
                logs: [
                  { time: '19:26:18', text: `开始执行：${step.name}`, level: 'cmd' as const },
                  { time: '19:26:20', text: '正在采集输出与校验健康探针...', level: 'info' as const },
                ],
              }
            }
            return step
          })

          const allDone = updatedSteps.every((s) => s.status === 'succeeded')
          const anyRunning = updatedSteps.some((s) => s.status === 'running')
          return {
            ...job,
            status: allDone ? ('succeeded' as const) : anyRunning ? ('running' as const) : job.status,
            durationSeconds: updatedSteps.reduce((acc, s) => acc + (s.durationSeconds ?? 0), 0),
            steps: updatedSteps,
          }
        })

        const finishedAll = !nextStep
        return {
          ...run,
          status: finishedAll ? ('succeeded' as const) : ('running' as const),
          finishedAt: finishedAll ? '2026/11/26 19:26:24' : null,
          durationSeconds: (run.durationSeconds ?? 0) + 11,
          jobs: nextJobs,
          artifacts:
            finishedAll && run.artifacts.length === 0
              ? [
                  {
                    id: `art-${run.id}-1`,
                    name: `${run.workflowName}-report-${run.commitSha.slice(0, 8)}.log`,
                    stepIndex: currentStep.index,
                    stepName: currentStep.name,
                    sizeLabel: '21.6 KB',
                    sha256: 'e84c1290f4a1b93022c7d41850fa22193c8410ab',
                    createdAt: '2026/11/26 19:26',
                    retentionDays: 30,
                  },
                ]
              : run.artifacts,
        }
      }),
    )
    showToast('已推进实时演示步骤状态')
  }

  // 如果 URL 指定了某次运行，直接渲染新版运行详情页
  if (selectedRun) {
    return (
      <PipelineRunDetailView
        run={selectedRun}
        initialStepIndex={initialStepIndex}
        canOperate={canOperate}
        onBack={() => updateParams({ run: null, step: null })}
        onRerun={handleRerun}
        onCancel={handleCancelRun}
        onAdvanceLive={handleAdvanceLive}
        onToast={showToast}
      />
    )
  }

  const runningCount = runs.filter((r) => isProtoRunActive(r.status)).length
  const succeededCount = runs.filter((r) => r.status === 'succeeded').length
  const failedCount = runs.filter((r) => r.status === 'failed' || r.status === 'interrupted').length
  const passRate = runs.length > 0 ? Math.round((succeededCount / Math.max(1, succeededCount + failedCount)) * 100) : 0
  const distinctBranches = Array.from(new Set(runs.map((r) => r.ref)))

  return (
    <div className="pl-root">
      {/* 顶部上下文栏：解析分支、固定提交、节点状态、触发主操作 */}
      <div className="pl-context-bar">
        <div className="pl-context-left">
          <div className="pl-ref-select-wrap">
            <GitBranch size={13} className="quiet" aria-hidden="true" />
            <select
              aria-label="工作流解析分支"
              value={selectedRef}
              onChange={(event) => {
                setSelectedRef(event.target.value)
                showToast(`已切换到 ${event.target.value} 分支解析工作流定义`)
              }}
            >
              {projectRefs.map((item) => (
                <option key={item.ref} value={item.ref}>
                  {item.ref}
                </option>
              ))}
            </select>
          </div>

          {activeRefMeta && (
            <span className="pl-context-commit">
              <GitCommitHorizontal size={14} className="quiet" aria-hidden="true" />
              <span className="mono">{activeRefMeta.commitSha.slice(0, 8)}</span>
              <span className="pl-context-dir mono">.devops/workflows/</span>
            </span>
          )}
        </div>

        <div className="pl-context-right">
          <button
            type="button"
            className="pl-node-summary"
            onClick={() => setNodesDialogOpen(true)}
            aria-label="查看自托管执行节点状态"
          >
            <span className={`dot ${onlineNodes.length > 0 ? 'green' : 'red'}`} />
            <Server size={13} aria-hidden="true" />
            <span>
              {onlineNodes.length}/{protoPipelineNodes.length} 执行节点在线
            </span>
          </button>

          <ProtoButton onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw size={14} className={isRefreshing ? 'pl-spin' : undefined} aria-hidden="true" />
            {isRefreshing ? '检查中…' : '重新检查'}
          </ProtoButton>

          <ProtoButton
            variant={activeWorkflow?.valid ? 'default' : 'primary'}
            disabled={!canOperate || validWorkflows.length === 0}
            title={!canOperate ? '浏览者只读，无权触发流水线' : undefined}
            onClick={() => openTriggerModal(activeWorkflow ?? undefined)}
          >
            <Play size={14} aria-hidden="true" />
            触发运行
          </ProtoButton>
        </div>
      </div>

      {/* 移动端工作流横向切换条 */}
      <div className="pl-mobile-workflow-bar" role="tablist" aria-label="切换工作流">
        <button
          type="button"
          className={`pl-mobile-wf-pill ${selectedWorkflowPath === '' ? 'active' : ''}`}
          onClick={() => updateParams({ workflow: null })}
        >
          <Layers size={13} aria-hidden="true" />
          全部工作流 ({runs.length})
        </button>
        {workflows.map((wf) => (
          <button
            key={wf.path}
            type="button"
            className={`pl-mobile-wf-pill ${selectedWorkflowPath === wf.path ? 'active' : ''}`}
            onClick={() => updateParams({ workflow: wf.path })}
          >
            <span className={`dot ${wf.valid ? 'green' : 'red'}`} />
            {wf.name}
          </button>
        ))}
      </div>

      {/* 主从工作台：左侧工作流目录 + 右侧摘要与运行过程列表 */}
      <div className="pl-workspace">
        {/* 左侧工作流目录（GitHub Actions 风格 + Jenkins 健康条） */}
        <aside className="pl-workflow-rail" aria-label="仓库工作流目录">
          <div className="pl-rail-header">
            <span>工作流（{workflows.length}）</span>
            <span>最近趋势</span>
          </div>

          <button
            type="button"
            className={`pl-workflow-item ${selectedWorkflowPath === '' ? 'active' : ''}`}
            onClick={() => updateParams({ workflow: null })}
          >
            <div className="pl-wf-top">
              <Layers size={14} className="pl-tone-running pl-icon" aria-hidden="true" />
              <span className="pl-wf-name">全部工作流</span>
              <span className="pl-wf-count">{runs.length}</span>
            </div>
            <div className="pl-wf-meta">
              <span>{validWorkflows.length} 个可运行</span>
              {workflows.length - validWorkflows.length > 0 && (
                <span className="pl-wf-tag danger">{workflows.length - validWorkflows.length} 个解析失败</span>
              )}
              {runningCount > 0 && <span className="pl-wf-tag">{runningCount} 个进行中</span>}
            </div>
          </button>

          {workflows.map((wf) => {
            const wfRuns = runs.filter((r) => r.workflowPath === wf.path)
            const latest = wfRuns[0] ?? null
            const totalSteps = wf.jobs.reduce((sum, job) => sum + job.steps.length, 0)
            const isSelected = selectedWorkflowPath === wf.path

            return (
              <button
                key={wf.path}
                type="button"
                className={`pl-workflow-item ${isSelected ? 'active' : ''}`}
                onClick={() => updateParams({ workflow: wf.path })}
              >
                <div className="pl-wf-top">
                  {wf.valid ? (
                    latest ? (
                      <PipelineStatusIcon status={latest.status} size={14} />
                    ) : (
                      <span className="dot green" />
                    )
                  ) : (
                    <AlertCircle size={14} className="pl-tone-danger pl-icon" aria-hidden="true" />
                  )}
                  <span className="pl-wf-name">{wf.name}</span>
                  <span className="pl-wf-count">{wfRuns.length}</span>
                </div>

                <div className="pl-wf-meta">
                  {wf.valid ? (
                    <>
                      <span className="pl-wf-tag mono">{wf.runsOn[0]}</span>
                      <span>
                        {wf.jobs.length > 1 ? `${wf.jobs.length} 阶段 · ` : ''}
                        {totalSteps} 步
                      </span>
                      {wf.inputs.length > 0 && <span>· {wf.inputs.length} 参数</span>}
                    </>
                  ) : (
                    <span className="pl-wf-tag danger">解析失败（{wf.parseErrors.length} 处错误）</span>
                  )}
                </div>

                <div className="pl-wf-footer">
                  <div className="pl-trend-bars" aria-label="最近运行趋势">
                    {wf.recentOutcomes.length > 0
                      ? wf.recentOutcomes.map((outcome, idx) => (
                          <span
                            key={idx}
                            className={`pl-trend-bar ${outcome}`}
                            title={getRunStatusMeta(outcome).label}
                          />
                        ))
                      : [0, 1, 2].map((idx) => <span key={idx} className="pl-trend-bar" title="暂无记录" />)}
                  </div>
                  <span className="pl-wf-last-time">
                    {latest
                      ? `${formatCompactDuration(latest.durationSeconds) || getRunStatusMeta(latest.status).label} · ${latest.relativeTime}`
                      : '尚未运行'}
                  </span>
                </div>
              </button>
            )
          })}
        </aside>

        {/* 右侧主内容区 */}
        <section className="pl-main-col" aria-label="工作流详情与运行记录">
          {/* 当选中单个工作流时：展示具体配置、参数、节点标签、步骤链路与解析错误 */}
          {activeWorkflow ? (
            <div className={`pl-workflow-summary ${activeWorkflow.valid ? '' : 'invalid'}`}>
              <div className="pl-wf-summary-head">
                <div>
                  <div className="pl-wf-summary-title">
                    <h2>{activeWorkflow.name}</h2>
                    {activeWorkflow.valid ? (
                      <span className="pl-status-badge pl-tone-success">可运行</span>
                    ) : (
                      <span className="pl-status-badge pl-tone-danger">解析失败</span>
                    )}
                    <span className="badge mono">{activeWorkflow.path}</span>
                  </div>
                  <p className="pl-wf-summary-desc">{activeWorkflow.description}</p>
                </div>

                <div className="row">
                  <ProtoButton onClick={() => setInspectWorkflow(activeWorkflow)}>
                    <FileCode2 size={14} aria-hidden="true" />
                    查看 YAML 与计划
                  </ProtoButton>
                  {activeWorkflow.valid && (
                    <ProtoButton
                      variant="primary"
                      disabled={!canOperate}
                      onClick={() => openTriggerModal(activeWorkflow)}
                    >
                      <Play size={14} aria-hidden="true" />
                      触发此工作流
                    </ProtoButton>
                  )}
                </div>
              </div>

              {/* 具体的值：触发方式、目标节点、超时、声明参数 */}
              <div className="pl-wf-facts">
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">触发方式</span>
                  <span className="mono">workflow_dispatch</span>
                </span>
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">执行节点</span>
                  <span className="mono">{activeWorkflow.runsOn.join(', ') || '—'}</span>
                </span>
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">超时上限</span>
                  <span>{activeWorkflow.timeoutMinutes} 分钟</span>
                </span>
                <span className="pl-wf-fact">
                  <span className="pl-wf-fact-label">输入参数</span>
                  <span>
                    {activeWorkflow.inputs.length > 0
                      ? activeWorkflow.inputs.map((i) => `${i.name}=${String(i.defaultValue)}`).join(' · ')
                      : '无'}
                  </span>
                </span>
              </div>

              {/* 静态执行链路预览 / 解析错误明示 */}
              {activeWorkflow.valid ? (
                <div className="pl-blueprint-strip" aria-label="工作流阶段链路预览">
                  {activeWorkflow.jobs.map((job, jobIdx) => (
                    <div key={job.id} className="row" style={{ gap: 6 }}>
                      {jobIdx > 0 && <ArrowRight size={14} className="pl-blueprint-arrow" aria-hidden="true" />}
                      <div className="pl-blueprint-job">
                        <span className="pl-blueprint-job-name">{job.name}</span>
                        <span className="pl-blueprint-steps">{job.steps.map((s) => s.name).join(' → ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pl-parse-errors" role="alert">
                  {activeWorkflow.parseErrors.map((err, index) => (
                    <div key={`${err.code}-${index}`} className="pl-parse-error-item">
                      <AlertCircle size={15} className="pl-tone-danger pl-icon" aria-hidden="true" />
                      <div>
                        <div className="pl-parse-error-meta">
                          <span className="mono">
                            第 {err.line} 行第 {err.column} 列 · {err.fieldPath}
                          </span>
                          <span className="badge red">{err.code}</span>
                        </div>
                        <p>{err.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 选中“全部工作流”时展示紧凑的项目流水线健康概览 */
            <div className="pl-overview-metrics" aria-label="流水线概览指标">
              <div className="pl-metric-card">
                <span className="pl-metric-label">进行中 / 排队</span>
                <span className="pl-metric-value">
                  <span className={runningCount > 0 ? 'pl-tone-running' : undefined}>{runningCount}</span>
                  <span className="pl-metric-sub">实时推进</span>
                </span>
              </div>
              <div className="pl-metric-card">
                <span className="pl-metric-label">可运行工作流</span>
                <span className="pl-metric-value">
                  {validWorkflows.length}
                  <span className="pl-metric-sub">/ {workflows.length} 个定义</span>
                </span>
              </div>
              <div className="pl-metric-card">
                <span className="pl-metric-label">近期成功率</span>
                <span className="pl-metric-value">
                  <span className="pl-tone-success">{passRate}%</span>
                  <span className="pl-metric-sub">
                    {succeededCount} 通过 · {failedCount} 异常
                  </span>
                </span>
              </div>
              <div className="pl-metric-card">
                <span className="pl-metric-label">最近平均耗时</span>
                <span className="pl-metric-value">
                  1 分 49 秒<span className="pl-metric-sub">主干构建</span>
                </span>
              </div>
            </div>
          )}

          {/* 筛选与搜索条 */}
          <div className="pl-run-toolbar">
            <div className="segments" role="group" aria-label="按运行状态筛选">
              {STATUS_FILTER_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`segment ${statusFilter === item.value ? 'active' : ''}`}
                  onClick={() => setStatusFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <select
              className="btn"
              style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
              aria-label="按分支筛选运行"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
            >
              <option value="">全部分支</option>
              {distinctBranches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>

            <ProtoSearch
              label="搜索流水线运行"
              placeholder="搜索运行号、提交、分支或发起人"
              value={query}
              onChange={setQuery}
            />
          </div>

          {/* 运行历史列表：每条直接内嵌阶段进度条（解决“看不到流水线运行过程”） */}
          {filteredRuns.length === 0 ? (
            <ProtoEmpty
              icon="terminal"
              title={runs.length === 0 ? '还没有流水线运行记录' : '没有匹配的运行记录'}
              description={
                runs.length === 0
                  ? '在左侧选择任意可运行的工作流并点击「触发运行」，执行过程与阶段日志会实时展示在这里。'
                  : '当前筛选条件下没有结果，可以调整状态、分支或清除搜索词。'
              }
              action={
                runs.length === 0 ? (
                  canOperate && validWorkflows.length > 0 ? (
                    <ProtoButton variant="primary" onClick={() => openTriggerModal(activeWorkflow ?? undefined)}>
                      触发运行
                    </ProtoButton>
                  ) : undefined
                ) : (
                  <ProtoButton
                    onClick={() => {
                      setStatusFilter('all')
                      setBranchFilter('')
                      setQuery('')
                    }}
                  >
                    清除筛选
                  </ProtoButton>
                )
              }
            />
          ) : (
            <div className="pl-run-list" aria-label="流水线运行历史">
              {filteredRuns.map((run) => {
                const steps = flattenRunSteps(run)
                const progress = countRunStepProgress(run)
                const active = isProtoRunActive(run.status)
                const statusMeta = getRunStatusMeta(run.status)
                const inputEntries = Object.entries(run.inputs)

                return (
                  <article
                    key={run.id}
                    className={`pl-run-card ${run.status === 'running' ? 'is-running' : ''} ${
                      run.status === 'failed' || run.status === 'interrupted' ? 'is-failed' : ''
                    }`}
                  >
                    {/* 第一行：主标识 + 耗时 + 快捷操作 */}
                    <div className="pl-run-head">
                      <div className="pl-run-title-group">
                        <span className="pl-run-title-icon" title={statusMeta.label}>
                          <PipelineStatusIcon status={run.status} size={17} />
                        </span>
                        <div className="pl-run-title-body">
                          <div className="pl-run-title-row">
                            <button
                              type="button"
                              className="pl-run-title-btn"
                              onClick={() => updateParams({ run: run.id, step: null })}
                            >
                              {run.commitMessage}
                            </button>
                            <span className="pl-run-num mono">#{run.runNumber}</span>
                            <button
                              type="button"
                              className="badge"
                              title="查看该工作流"
                              onClick={() => updateParams({ workflow: run.workflowPath })}
                            >
                              {run.workflowName}
                            </button>
                            <span className="small quiet">
                              {progress.succeeded}/{progress.total} 步通过
                            </span>
                          </div>

                          {/* 第二行：具体上下文值（分支、提交、发起人、节点、触发参数） */}
                          <div className="pl-run-meta-row">
                            <span className="pl-meta-pill branch">
                              <GitBranch size={11} aria-hidden="true" />
                              {run.ref}
                            </span>
                            <span className="mono">{run.commitSha.slice(0, 8)}</span>
                            <span className="row" style={{ gap: 4 }}>
                              <User size={12} className="quiet" aria-hidden="true" />
                              {run.initiator} ({run.initiatorChannel})
                            </span>
                            <span className="row" style={{ gap: 4 }}>
                              <Server size={12} className="quiet" aria-hidden="true" />
                              {run.nodeName ?? `等待 ${run.nodeTag}`}
                            </span>
                            {inputEntries.map(([key, value]) => (
                              <span key={key} className="pl-meta-pill input-kv">
                                {key}={String(value)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="pl-run-right">
                        <div className="pl-run-timing">
                          <span className="pl-run-duration">
                            <Clock size={12} className="quiet" aria-hidden="true" />
                            {run.durationSeconds !== null ? formatProtoDuration(run.durationSeconds) : statusMeta.label}
                          </span>
                          <span>{run.relativeTime}</span>
                        </div>

                        {run.status === 'running' && (
                          <ProtoButton
                            style={{ minHeight: 30, padding: '4px 9px', fontSize: 12 }}
                            onClick={() => handleAdvanceLive(run.id)}
                          >
                            推进演示
                          </ProtoButton>
                        )}
                        {active && canOperate ? (
                          <ProtoButton
                            style={{ minHeight: 30, padding: '4px 9px', fontSize: 12 }}
                            onClick={() => handleCancelRun(run)}
                          >
                            <Square size={12} aria-hidden="true" />
                            取消
                          </ProtoButton>
                        ) : !active && canOperate ? (
                          <ProtoButton
                            style={{ minHeight: 30, padding: '4px 9px', fontSize: 12 }}
                            onClick={() => handleRerun(run)}
                          >
                            <RotateCcw size={12} aria-hidden="true" />
                            重跑
                          </ProtoButton>
                        ) : null}
                        <ProtoButton
                          variant="ghost"
                          style={{ minHeight: 30, padding: '4px 9px', fontSize: 12 }}
                          onClick={() => updateParams({ run: run.id, step: null })}
                        >
                          详情
                        </ProtoButton>
                      </div>
                    </div>

                    {/* 第三行：内嵌流水线执行过程阶段条（点击阶段直达该步日志） */}
                    <div className="pl-stage-track" aria-label={`运行 #${run.runNumber} 执行过程`}>
                      {steps.map((step, idx) => {
                        const prevStep = idx > 0 ? steps[idx - 1] : null
                        const jobChanged = prevStep && prevStep.jobId !== step.jobId
                        const dur = formatCompactDuration(step.durationSeconds)
                        return (
                          <div key={step.index} className="row" style={{ gap: 4 }}>
                            {idx > 0 &&
                              (jobChanged ? (
                                <span className="pl-stage-job-sep" title={`下一阶段：${step.jobName}`}>
                                  <ArrowRight size={13} aria-hidden="true" />
                                </span>
                              ) : (
                                <span
                                  className={`pl-stage-connector ${
                                    step.status === 'succeeded'
                                      ? 'done'
                                      : step.status === 'running'
                                        ? 'active'
                                        : step.status === 'failed' || step.status === 'interrupted'
                                          ? 'error'
                                          : ''
                                  }`}
                                />
                              ))}
                            <button
                              type="button"
                              className={`pl-stage-pill ${step.status}`}
                              title={`点击查看「${step.name}」日志（${getStepStatusMeta(step.status).label}）`}
                              onClick={() => updateParams({ run: run.id, step: step.index })}
                            >
                              <PipelineStatusIcon status={step.status} size={13} />
                              <span>{step.name}</span>
                              {dur && <span className="pl-stage-dur">{dur}</span>}
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    {/* 失败 / 排队 / 中断的就地原因摘要 */}
                    {run.errorMessage && (
                      <div className={`pl-run-error-line ${run.status === 'queued' ? 'warning' : ''}`}>
                        <AlertTriangle size={14} className="pl-icon" aria-hidden="true" />
                        <span>{run.errorMessage}</span>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* 弹窗组：工作流 YAML 与计划查看 / 智能参数触发 / 执行节点状态 */}
      <WorkflowDefinitionDialog
        workflow={inspectWorkflow}
        open={inspectWorkflow !== null}
        canTrigger={canOperate}
        onClose={() => setInspectWorkflow(null)}
        onTrigger={(wf) => openTriggerModal(wf)}
      />

      <TriggerPipelineDialog
        open={triggerOpen}
        workflows={validWorkflows}
        initialWorkflowPath={triggerInitialPath}
        refs={projectRefs}
        defaultRef={selectedRef}
        onClose={() => setTriggerOpen(false)}
        onSubmit={({ workflow, ref, inputs }) => createDemoRun(workflow, ref, inputs)}
      />

      <PipelineNodesOverviewDialog
        open={nodesDialogOpen}
        nodes={protoPipelineNodes}
        onClose={() => setNodesDialogOpen(false)}
      />
    </div>
  )
}
