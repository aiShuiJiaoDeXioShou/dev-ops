import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileCode2,
  GitBranch,
  Package,
  Play,
  RotateCcw,
  Search,
  Server,
  Square,
  Terminal,
  User,
} from 'lucide-react'
import { ProtoButton, ProtoEmpty } from '@/prototype/components/proto-controls'
import { flattenRunSteps, type ProtoPipelineRun, type ProtoPipelineStepRun } from '@/prototype/data/pipelines'
import {
  formatCompactDuration,
  formatProtoDuration,
  getStepKindLabel,
  getStepStatusMeta,
  isProtoRunActive,
  PipelineStatusIcon,
  RunStatusBadge,
} from './pipeline-status'

type DetailTab = 'logs' | 'artifacts' | 'snapshot'

/**
 * 推导运行详情打开时默认展开的步骤：优先运行中步骤，其次失败/中断步骤，最后回退到最后一个有日志的步骤。
 * @param steps 运行内所有步骤。
 * @returns 推荐展开的步骤序号。
 */
function pickInitialStepIndex(steps: ProtoPipelineStepRun[]): number {
  const running = steps.find((step) => step.status === 'running')
  if (running) return running.index
  const failed = steps.find((step) => step.status === 'failed' || step.status === 'interrupted')
  if (failed) return failed.index
  const lastWithLogs = [...steps].reverse().find((step) => step.logs.length > 0)
  return lastWithLogs?.index ?? steps[0]?.index ?? 0
}

/**
 * 渲染重塑后的流水线运行详情视图。
 *
 * 融合 Jenkins Blue Ocean 阶段拓扑流与 GitHub Actions 左右步骤树 + 折叠手风琴终端：
 * 顶部单行紧凑元信息栏释放首屏空间，步骤与日志就地融合，支持搜索、时间戳、复制与下载。
 * @param props 运行记录、初始聚焦步骤、权限与交互回调。
 * @returns 运行详情界面。
 */
export function PipelineRunDetailView({
  run,
  initialStepIndex,
  canOperate,
  onBack,
  onRerun,
  onCancel,
  onAdvanceLive,
  onToast,
}: {
  run: ProtoPipelineRun
  initialStepIndex: number | null
  canOperate: boolean
  onBack: () => void
  onRerun: (run: ProtoPipelineRun) => void
  onCancel: (run: ProtoPipelineRun) => void
  onAdvanceLive: (runId: string) => void
  onToast: (message: string) => void
}) {
  const allSteps = useMemo(() => flattenRunSteps(run), [run])
  const initialStepForRun = useMemo(
    () => initialStepIndex ?? pickInitialStepIndex(allSteps),
    [allSteps, initialStepIndex],
  )
  const activeRun = isProtoRunActive(run.status)

  const [activeTab, setActiveTab] = useState<DetailTab>('logs')
  const [selectedJobId, setSelectedJobId] = useState<string>('all')
  const [focusedStepIndex, setFocusedStepIndex] = useState<number>(initialStepForRun)
  const [expandedSteps, setExpandedSteps] = useState<number[]>([initialStepForRun])
  const [logQuery, setLogQuery] = useState('')
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [followLogs, setFollowLogs] = useState(activeRun)
  const [copiedSha, setCopiedSha] = useState(false)

  useEffect(() => {
    setFocusedStepIndex(initialStepForRun)
    setExpandedSteps([initialStepForRun])
    setSelectedJobId('all')
    setActiveTab('logs')
    setFollowLogs(activeRun)
  }, [run.id, initialStepForRun, activeRun])

  const visibleJobs = selectedJobId === 'all' ? run.jobs : run.jobs.filter((job) => job.id === selectedJobId)
  const visibleSteps = visibleJobs.flatMap((job) => job.steps)

  const toggleStep = (stepIndex: number) => {
    setFocusedStepIndex(stepIndex)
    setExpandedSteps((prev) =>
      prev.includes(stepIndex) ? prev.filter((item) => item !== stepIndex) : [...prev, stepIndex],
    )
  }

  const jumpToStep = (stepIndex: number, jobId?: string) => {
    setActiveTab('logs')
    if (jobId && selectedJobId !== 'all' && selectedJobId !== jobId) setSelectedJobId('all')
    setFocusedStepIndex(stepIndex)
    setExpandedSteps((prev) => (prev.includes(stepIndex) ? prev : [...prev, stepIndex]))
  }

  const expandAll = () => setExpandedSteps(visibleSteps.map((step) => step.index))
  const collapseAll = () => setExpandedSteps([])

  const copyCommitSha = async () => {
    try {
      await navigator.clipboard.writeText(run.commitSha)
      setCopiedSha(true)
      onToast(`已复制提交 SHA：${run.commitSha.slice(0, 12)}`)
      setTimeout(() => setCopiedSha(false), 1600)
    } catch {
      onToast('演示环境剪贴板受限，完整 SHA 已展示在提示中')
    }
  }

  const copyAllLogs = async () => {
    const text = visibleSteps
      .map((step) => {
        const header = `=== [${step.index + 1}] ${step.name} ===`
        const lines = step.logs.map((line) => `${line.time}  ${line.text}`).join('\n')
        return `${header}\n${lines || '(无日志输出)'}`
      })
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      onToast('已复制当前视图的完整步骤日志')
    } catch {
      onToast('已整理日志文本（浏览器拒绝剪贴板写入）')
    }
  }

  const downloadRawLogs = () => {
    const text = allSteps
      .map((step) =>
        [`# Step ${step.index + 1}: ${step.name}`, ...step.logs.map((l) => `[${l.time}] ${l.text}`)].join('\n'),
      )
      .join('\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${run.workflowName}-run-${run.runNumber}.log`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    onToast(`已导出日志 ${run.workflowName}-run-${run.runNumber}.log`)
  }

  const inputEntries = Object.entries(run.inputs)

  return (
    <div className="pl-detail-root">
      {/* 顶部面包屑与动作区 */}
      <div className="pl-detail-header">
        <div className="pl-detail-title-wrap">
          <nav className="breadcrumb" aria-label="流水线运行面包屑" style={{ marginBottom: 2 }}>
            <button type="button" className="text-btn row" style={{ gap: 5, padding: 0 }} onClick={onBack}>
              <ArrowLeft size={14} aria-hidden="true" />
              返回流水线列表
            </button>
            <span>/</span>
            <span>{run.workflowName}</span>
            <span>/</span>
            <span className="mono">
              #{run.runNumber} ({run.shortId})
            </span>
          </nav>

          <div className="pl-detail-title-line">
            <RunStatusBadge status={run.status} />
            <h2>
              #{run.runNumber} {run.commitMessage}
            </h2>
          </div>
        </div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          {run.status === 'running' && (
            <ProtoButton onClick={() => onAdvanceLive(run.id)}>
              <Play size={14} aria-hidden="true" />
              演示推进一步
            </ProtoButton>
          )}
          {activeRun && canOperate && (
            <ProtoButton onClick={() => onCancel(run)}>
              <Square size={13} aria-hidden="true" />
              取消运行
            </ProtoButton>
          )}
          {!activeRun && canOperate && (
            <ProtoButton variant="primary" onClick={() => onRerun(run)}>
              <RotateCcw size={14} aria-hidden="true" />
              重新运行
            </ProtoButton>
          )}
          <ProtoButton onClick={() => setActiveTab('snapshot')}>
            <FileCode2 size={14} aria-hidden="true" />
            工作流快照
          </ProtoButton>
        </div>
      </div>

      {/* 单行紧凑元信息栏（替代原版 8 行竖排） */}
      <div className="pl-meta-strip" aria-label="运行关键元信息">
        <div className="pl-meta-cell">
          <span className="pl-meta-cell-label">分支 / 固定提交</span>
          <span className="pl-meta-cell-value">
            <GitBranch size={13} className="quiet pl-icon" aria-hidden="true" />
            <span className="mono pl-meta-truncate" title={run.ref}>
              {run.ref}
            </span>
            <span className="quiet pl-meta-nowrap">·</span>
            <span className="mono pl-meta-nowrap" title={run.commitSha}>
              {run.commitSha.slice(0, 8)}
            </span>
            <button
              type="button"
              className="icon-btn pl-meta-nowrap"
              style={{ width: 22, height: 22 }}
              aria-label="复制完整提交 SHA"
              onClick={copyCommitSha}
            >
              {copiedSha ? <Check size={12} className="pl-tone-success" /> : <Copy size={12} />}
            </button>
          </span>
        </div>

        <div className="pl-meta-cell">
          <span className="pl-meta-cell-label">发起人 / 触发方式</span>
          <span className="pl-meta-cell-value">
            <User size={13} className="quiet pl-icon" aria-hidden="true" />
            <span className="pl-meta-truncate">
              {run.initiator} · 手动（{run.initiatorChannel}）
            </span>
          </span>
        </div>

        <div className="pl-meta-cell">
          <span className="pl-meta-cell-label">执行节点</span>
          <span className="pl-meta-cell-value">
            <Server size={13} className="quiet pl-icon" aria-hidden="true" />
            <span className="pl-meta-truncate">{run.nodeName ?? `等待 ${run.nodeTag}`}</span>
          </span>
        </div>

        <div className="pl-meta-cell">
          <span className="pl-meta-cell-label">开始时间 / 总耗时</span>
          <span className="pl-meta-cell-value">
            <Clock size={13} className="quiet pl-icon" aria-hidden="true" />
            <span className="pl-meta-truncate">
              {run.startedAt ? run.startedAt.slice(11) : '尚未开始'} · {formatProtoDuration(run.durationSeconds)}
            </span>
          </span>
        </div>

        <div className="pl-meta-cell">
          <span className="pl-meta-cell-label">触发输入参数</span>
          <span className="pl-meta-cell-value">
            {inputEntries.length > 0 ? (
              <span
                className="mono small pl-meta-truncate"
                title={inputEntries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
              >
                {inputEntries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
              </span>
            ) : (
              <span className="quiet">使用默认配置</span>
            )}
          </span>
        </div>
      </div>

      {/* 异常终态 / 排队原因紧凑横幅 */}
      {run.errorMessage && (
        <div
          className={`pl-run-error-line ${run.status === 'queued' ? 'warning' : ''}`}
          style={{ marginLeft: 0 }}
          role="alert"
        >
          <AlertTriangle size={15} className="pl-icon" aria-hidden="true" />
          <span>
            {run.errorCode ? <strong className="mono">[{run.errorCode}] </strong> : null}
            {run.errorMessage}
          </span>
        </div>
      )}

      {/* 顶部水平执行过程图：多 Job 显示 Job DAG，单 Job 显示可视化步骤节点流 */}
      <section className="pl-graph-card" aria-label="流水线执行过程图">
        <div className="pl-graph-header">
          <span className="pl-graph-title">
            执行过程
            <span className="counter">
              {run.jobs.length > 1 ? `${run.jobs.length} 个阶段 · ${allSteps.length} 步` : `${allSteps.length} 个步骤`}
            </span>
          </span>
          {run.jobs.length > 1 && (
            <button
              type="button"
              className="text-btn small"
              onClick={() => setSelectedJobId('all')}
              style={{ opacity: selectedJobId === 'all' ? 0.55 : 1 }}
            >
              {selectedJobId === 'all' ? '正在查看全部阶段' : '显示全部阶段'}
            </button>
          )}
        </div>

        {run.jobs.length > 1 ? (
          <div className="pl-graph-flow">
            {run.jobs.map((job, idx) => {
              const doneCount = job.steps.filter((s) => s.status === 'succeeded').length
              const pct = job.steps.length > 0 ? Math.round((doneCount / job.steps.length) * 100) : 0
              const isSelected = selectedJobId === job.id
              return (
                <div key={job.id} className="row" style={{ gap: 10, flexShrink: 0 }}>
                  {idx > 0 && (
                    <span className="pl-graph-edge" aria-hidden="true">
                      <ArrowRight size={16} />
                    </span>
                  )}
                  <button
                    type="button"
                    className={`pl-job-node ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedJobId(isSelected ? 'all' : job.id)
                      setActiveTab('logs')
                    }}
                  >
                    <div className="pl-job-node-top">
                      <PipelineStatusIcon status={job.status} size={15} />
                      <span className="pl-job-node-name">{job.name}</span>
                      <span className="small quiet">
                        {formatCompactDuration(job.durationSeconds) || getStepStatusMeta(job.status).label}
                      </span>
                    </div>
                    <div className="pl-job-progress-bar">
                      <div
                        className={`pl-job-progress-fill ${job.status}`}
                        style={{ width: `${job.status === 'running' ? Math.max(pct, 45) : pct}%` }}
                      />
                    </div>
                    <div className="pl-job-node-meta">
                      <span className="mono">{job.runsOn}</span>
                      <span>
                        {doneCount}/{job.steps.length} 步通过
                      </span>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="pl-stage-track" style={{ marginLeft: 0 }}>
            {allSteps.map((step, idx) => {
              const dur = formatCompactDuration(step.durationSeconds)
              const isFocused = focusedStepIndex === step.index && activeTab === 'logs'
              return (
                <div key={step.index} className="row" style={{ gap: 4 }}>
                  {idx > 0 && (
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
                  )}
                  <button
                    type="button"
                    className={`pl-stage-pill ${step.status}`}
                    style={isFocused ? { outline: '2px solid var(--blue)', outlineOffset: 1 } : undefined}
                    onClick={() => jumpToStep(step.index)}
                  >
                    <PipelineStatusIcon status={step.status} size={13} />
                    <span>
                      {idx + 1}. {step.name}
                    </span>
                    <span className="pl-stage-dur">
                      {dur || (step.status === 'running' ? '执行中…' : getStepStatusMeta(step.status).label)}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 详情页签：执行日志 / 运行产物 / 工作流快照 */}
      <div className="pl-subtabs">
        <div className="pl-subtab-list" role="tablist" aria-label="运行详情分区">
          <button
            type="button"
            role="tab"
            className="pl-subtab"
            aria-selected={activeTab === 'logs'}
            onClick={() => setActiveTab('logs')}
          >
            <Terminal size={14} aria-hidden="true" />
            执行日志
          </button>
          <button
            type="button"
            role="tab"
            className="pl-subtab"
            aria-selected={activeTab === 'artifacts'}
            onClick={() => setActiveTab('artifacts')}
          >
            <Package size={14} aria-hidden="true" />
            运行产物
            <span className="counter">{run.artifacts.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="pl-subtab"
            aria-selected={activeTab === 'snapshot'}
            onClick={() => setActiveTab('snapshot')}
          >
            <FileCode2 size={14} aria-hidden="true" />
            工作流快照与参数
          </button>
        </div>
        {activeTab === 'logs' && (
          <span className="small quiet" style={{ paddingBottom: 8 }}>
            {activeRun ? '运行中 · 自动接收分片日志' : '运行已结束 · 展示完整历史日志'}
          </span>
        )}
      </div>

      {/* 页签 1：左侧步骤导航 + 右侧折叠手风琴日志 */}
      {activeTab === 'logs' && (
        <div className="pl-log-workspace">
          <aside className="pl-step-nav" aria-label="步骤目录">
            {visibleJobs.map((job) => (
              <div key={job.id} className="pl-step-nav-group">
                <div className="pl-step-nav-group-title">
                  <span>{job.name}</span>
                  <span className="mono">{formatCompactDuration(job.durationSeconds)}</span>
                </div>
                {job.steps.map((step) => {
                  const isActive = focusedStepIndex === step.index
                  return (
                    <button
                      key={step.index}
                      type="button"
                      className={`pl-step-nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => jumpToStep(step.index, job.id)}
                    >
                      <PipelineStatusIcon status={step.status} size={14} />
                      <span className="pl-step-nav-name">
                        {step.index + 1}. {step.name}
                      </span>
                      <span className="pl-step-nav-dur">
                        {formatCompactDuration(step.durationSeconds) || (step.status === 'pending' ? '待跑' : '')}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </aside>

          <section className="pl-console-pane" aria-label="步骤执行日志">
            <div className="pl-console-toolbar">
              <label className="pl-console-search">
                <Search size={13} className="quiet" aria-hidden="true" />
                <input
                  aria-label="在日志中搜索"
                  placeholder="搜索日志关键字、错误码…"
                  value={logQuery}
                  onChange={(event) => setLogQuery(event.target.value)}
                />
              </label>

              <div className="pl-console-actions">
                <button
                  type="button"
                  className={`pl-console-btn ${showTimestamps ? 'active' : ''}`}
                  onClick={() => setShowTimestamps((prev) => !prev)}
                >
                  时间戳
                </button>
                {activeRun && (
                  <button
                    type="button"
                    className={`pl-console-btn ${followLogs ? 'active' : ''}`}
                    onClick={() => setFollowLogs((prev) => !prev)}
                  >
                    自动跟随
                  </button>
                )}
                <button type="button" className="pl-console-btn" onClick={expandAll}>
                  全部展开
                </button>
                <button type="button" className="pl-console-btn" onClick={collapseAll}>
                  全部收起
                </button>
                <button type="button" className="pl-console-btn" onClick={copyAllLogs}>
                  <Copy size={12} aria-hidden="true" />
                  复制
                </button>
                <button type="button" className="pl-console-btn" onClick={downloadRawLogs}>
                  <Download size={12} aria-hidden="true" />
                  导出
                </button>
              </div>
            </div>

            <div className="pl-accordion-list">
              {visibleSteps.map((step) => {
                const isExpanded = expandedSteps.includes(step.index) || logQuery.trim().length > 0
                const isFocused = focusedStepIndex === step.index
                const stepMeta = getStepStatusMeta(step.status)
                const query = logQuery.trim().toLowerCase()
                const filteredLogs = query
                  ? step.logs.filter((line) => line.text.toLowerCase().includes(query))
                  : step.logs

                return (
                  <div
                    key={step.index}
                    className={`pl-step-accordion ${isExpanded ? 'is-expanded' : ''} ${isFocused ? 'is-focused' : ''}`}
                  >
                    <button
                      type="button"
                      className="pl-step-accordion-trigger"
                      aria-expanded={isExpanded}
                      onClick={() => toggleStep(step.index)}
                    >
                      <ChevronRight size={14} className="pl-step-acc-chevron" aria-hidden="true" />
                      <PipelineStatusIcon status={step.status} size={15} />
                      <span className="pl-step-acc-title">
                        {step.index + 1}. {step.name}
                      </span>
                      <span className="pl-step-acc-meta">
                        <span className="badge">{getStepKindLabel(step.kind)}</span>
                        {step.exitCode !== null && (
                          <span className={`badge mono ${step.exitCode === 0 ? 'green' : 'red'}`}>
                            exit {step.exitCode}
                          </span>
                        )}
                        <span className="mono">
                          {formatProtoDuration(step.durationSeconds) === '—'
                            ? stepMeta.label
                            : formatProtoDuration(step.durationSeconds)}
                        </span>
                      </span>
                    </button>

                    {isExpanded && (
                      <div>
                        {step.errorMessage && (
                          <div className="pl-step-error-box" role="note">
                            <AlertTriangle size={14} className="pl-icon" aria-hidden="true" />
                            <span>
                              {step.errorCode ? `[${step.errorCode}] ` : ''}
                              {step.errorMessage}
                            </span>
                          </div>
                        )}
                        {filteredLogs.length > 0 ? (
                          <div className="pl-terminal-body" role="log" aria-label={`${step.name} 日志`}>
                            {filteredLogs.map((line, lineIdx) => (
                              <div key={lineIdx} className={`pl-log-line ${line.level ?? 'info'}`}>
                                <span className="pl-log-lineno">{lineIdx + 1}</span>
                                {showTimestamps && <span className="pl-log-time">{line.time}</span>}
                                <span className="pl-log-text">{line.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="pl-log-empty">
                            {query
                              ? `当前步骤中没有匹配「${logQuery}」的日志行。`
                              : step.status === 'pending'
                                ? '步骤尚未开始，将在前置步骤完成后输出日志。'
                                : step.status === 'skipped'
                                  ? '上游阶段未通过，已跳过此步骤。'
                                  : '该步骤没有产生标准输出。'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {/* 页签 2：运行产物 */}
      {activeTab === 'artifacts' && (
        <div>
          {run.artifacts.length === 0 ? (
            <ProtoEmpty
              icon="box"
              title="本次运行没有归档产物"
              description="当工作流使用 builtin:upload-artifact 成功收集文件或目录后，受控产物与 SHA-256 摘要会展示在这里。"
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>产物名称</th>
                    <th>来源步骤</th>
                    <th>大小</th>
                    <th>SHA-256</th>
                    <th>保留期</th>
                    <th>生成时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {run.artifacts.map((artifact) => (
                    <tr key={artifact.id}>
                      <td>
                        <strong>{artifact.name}</strong>
                      </td>
                      <td>
                        第 {artifact.stepIndex + 1} 步 · {artifact.stepName}
                      </td>
                      <td className="mono">{artifact.sizeLabel}</td>
                      <td className="mono" title={artifact.sha256}>
                        {artifact.sha256.slice(0, 12)}…
                      </td>
                      <td>{artifact.retentionDays} 天</td>
                      <td>{artifact.createdAt}</td>
                      <td>
                        <ProtoButton onClick={() => onToast(`演示下载受控产物：${artifact.name}`)}>
                          <Download size={13} aria-hidden="true" />
                          下载
                        </ProtoButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 页签 3：固定工作流快照与输入参数 */}
      {activeTab === 'snapshot' && (
        <div className="space-y-4">
          <div className="pl-wf-facts">
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">快照文件</span>
              <span className="mono">{run.workflowPath}</span>
            </span>
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">固定提交</span>
              <span className="mono">{run.commitSha}</span>
            </span>
          </div>

          {inputEntries.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>触发参数名</th>
                    <th>本次运行值</th>
                  </tr>
                </thead>
                <tbody>
                  {inputEntries.map(([key, value]) => (
                    <tr key={key}>
                      <td className="mono">{key}</td>
                      <td className="mono">{String(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pl-yaml-viewer" aria-label="本次运行的工作流 YAML 快照">
            {run.yamlSnapshot.split('\n').map((line, index) => (
              <div key={index} className="pl-yaml-line">
                <span className="pl-yaml-lineno">{index + 1}</span>
                <span className="pl-yaml-code">{line || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
