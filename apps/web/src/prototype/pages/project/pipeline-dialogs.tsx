import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, FileCode2, Play, Server, Terminal } from 'lucide-react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoField } from '@/prototype/components/proto-controls'
import { getStepKindLabel } from './pipeline-status'
import type { ProtoPipelineNode, ProtoPipelineWorkflow } from '@/prototype/data/pipelines'

/**
 * 渲染工作流详情弹窗：查看执行计划（Jobs / Steps / Inputs）或带行号 YAML 源码与解析错误。
 * @param props.workflow 当前选中的工作流；为空时不渲染内容。
 * @param props.open 弹窗打开状态。
 * @param props.canTrigger 当前角色是否允许触发运行。
 * @param props.onClose 关闭弹窗回调。
 * @param props.onTrigger 打开触发运行表单回调。
 * @returns 工作流详情对话框。
 */
export function WorkflowDefinitionDialog({
  workflow,
  open,
  canTrigger,
  onClose,
  onTrigger,
}: {
  workflow: ProtoPipelineWorkflow | null
  open: boolean
  canTrigger: boolean
  onClose: () => void
  onTrigger: (workflow: ProtoPipelineWorkflow) => void
}) {
  const [tab, setTab] = useState<'plan' | 'yaml'>('plan')

  useEffect(() => {
    if (open) setTab(workflow && !workflow.valid ? 'yaml' : 'plan')
  }, [open, workflow])

  const errorLines = new Set(workflow?.parseErrors.map((err) => err.line) ?? [])

  return (
    <PrototypeDialog
      open={open}
      title={workflow ? `工作流定义 · ${workflow.name}` : '工作流定义'}
      className="pl-wide-dialog"
      onClose={onClose}
    >
      {workflow && (
        <div className="space-y-4">
          <div className="pl-wf-facts">
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">文件</span>
              <span className="mono">{workflow.path}</span>
            </span>
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">基线</span>
              <span className="mono">
                {workflow.ref} · {workflow.commitSha.slice(0, 8)}
              </span>
            </span>
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">节点标签</span>
              <span>{workflow.runsOn.join(', ') || '未声明'}</span>
            </span>
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">超时</span>
              <span>{workflow.timeoutMinutes} 分钟</span>
            </span>
          </div>

          {!workflow.valid && workflow.parseErrors.length > 0 && (
            <div className="pl-parse-errors" role="alert">
              {workflow.parseErrors.map((error, index) => (
                <div key={`${error.code}-${index}`} className="pl-parse-error-item">
                  <AlertCircle size={16} className="pl-tone-danger pl-icon" aria-hidden="true" />
                  <div>
                    <div className="pl-parse-error-meta">
                      <span className="mono">
                        第 {error.line} 行第 {error.column} 列 · {error.fieldPath}
                      </span>
                      <span className="badge red">{error.code}</span>
                    </div>
                    <p>{error.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pl-subtabs">
            <div className="pl-subtab-list" role="tablist" aria-label="工作流定义视图">
              <button
                type="button"
                role="tab"
                className="pl-subtab"
                aria-selected={tab === 'plan'}
                onClick={() => setTab('plan')}
              >
                <Terminal size={14} aria-hidden="true" />
                执行计划（{workflow.jobs.length} 个 Job）
              </button>
              <button
                type="button"
                role="tab"
                className="pl-subtab"
                aria-selected={tab === 'yaml'}
                onClick={() => setTab('yaml')}
              >
                <FileCode2 size={14} aria-hidden="true" />
                YAML 源码快照
              </button>
            </div>
          </div>

          {tab === 'plan' ? (
            <div className="space-y-3">
              {workflow.inputs.length > 0 && (
                <div className="space-y-2">
                  <strong className="small">手动触发参数（workflow_dispatch.inputs）</strong>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>参数名</th>
                          <th>类型</th>
                          <th>默认值 / 可选项</th>
                          <th>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workflow.inputs.map((input) => (
                          <tr key={input.name}>
                            <td className="mono">
                              {input.name}
                              {input.required && (
                                <span className="badge blue" style={{ marginLeft: 6 }}>
                                  必填
                                </span>
                              )}
                            </td>
                            <td>{input.type}</td>
                            <td className="mono">
                              {String(input.defaultValue)}
                              {input.options ? ` (${input.options.join(' | ')})` : ''}
                            </td>
                            <td className="muted pl-wrap-cell">{input.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {workflow.jobs.length === 0 ? (
                <p className="small muted">解析失败的工作流无法生成运行计划，请先在仓库中修复 YAML 错误后提交。</p>
              ) : (
                workflow.jobs.map((job) => (
                  <div key={job.id} className="pl-plan-job-card">
                    <div className="row spread">
                      <div className="row">
                        <strong>{job.name}</strong>
                        <span className="badge mono">{job.id}</span>
                        {job.needs.length > 0 && <span className="badge blue">依赖：{job.needs.join(', ')}</span>}
                      </div>
                      <span className="small quiet">
                        runs-on: <span className="mono">{job.runsOn}</span> · 超时 {job.timeoutMinutes} 分钟
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {job.steps.map((step, idx) => (
                        <div key={step.index} className="pl-plan-step-row">
                          <span className="counter">{idx + 1}</span>
                          <span>{step.name}</span>
                          <span className="badge">{getStepKindLabel(step.kind)}</span>
                          {step.commandPreview && <code className="pl-plan-step-cmd mono">{step.commandPreview}</code>}
                          {step.artifactName && (
                            <span className="pl-plan-step-cmd mono">产物：{step.artifactName}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="pl-yaml-viewer" aria-label="YAML 源码">
              {workflow.yamlContent.split('\n').map((line, index) => {
                const lineNum = index + 1
                const hasError = errorLines.has(lineNum)
                return (
                  <div key={lineNum} className={`pl-yaml-line ${hasError ? 'has-error' : ''}`}>
                    <span className="pl-yaml-lineno">{lineNum}</span>
                    <span className="pl-yaml-code">{line || ' '}</span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="form-actions">
            <ProtoButton onClick={onClose}>关闭</ProtoButton>
            {workflow.valid && canTrigger && (
              <ProtoButton
                variant="primary"
                onClick={() => {
                  onClose()
                  onTrigger(workflow)
                }}
              >
                <Play size={14} aria-hidden="true" />
                触发此工作流
              </ProtoButton>
            )}
          </div>
        </div>
      )}
    </PrototypeDialog>
  )
}

/**
 * 智能触发运行弹窗：按工作流声明的 inputs 动态生成表单控件，不再要求手写 JSON。
 * @param props.open 打开状态。
 * @param props.workflows 当前项目所有可运行工作流。
 * @param props.initialWorkflowPath 初始选中的工作流路径。
 * @param props.refs 可选分支与提交列表。
 * @param props.defaultRef 默认选中的分支。
 * @param props.onClose 关闭弹窗回调。
 * @param props.onSubmit 提交触发请求回调。
 * @returns 手动触发流水线对话框。
 */
export function TriggerPipelineDialog({
  open,
  workflows,
  initialWorkflowPath,
  refs,
  defaultRef,
  onClose,
  onSubmit,
}: {
  open: boolean
  workflows: ProtoPipelineWorkflow[]
  initialWorkflowPath: string
  refs: Array<{ ref: string; commitSha: string; commitMessage: string }>
  defaultRef: string
  onClose: () => void
  onSubmit: (payload: {
    workflow: ProtoPipelineWorkflow
    ref: string
    inputs: Record<string, string | number | boolean>
  }) => void
}) {
  const [workflowPath, setWorkflowPath] = useState(initialWorkflowPath)
  const [selectedRef, setSelectedRef] = useState(defaultRef)
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({})

  const activeWorkflow = workflows.find((wf) => wf.path === workflowPath) ?? workflows[0] ?? null

  useEffect(() => {
    if (!open) return
    const nextWf = workflows.find((wf) => wf.path === initialWorkflowPath) ?? workflows[0] ?? null
    setWorkflowPath(nextWf?.path ?? '')
    setSelectedRef(defaultRef)
    if (nextWf) {
      const defaults: Record<string, string | number | boolean> = {}
      for (const input of nextWf.inputs) defaults[input.name] = input.defaultValue
      setInputValues(defaults)
    }
  }, [open, initialWorkflowPath, defaultRef, workflows])

  const handleWorkflowChange = (nextPath: string) => {
    setWorkflowPath(nextPath)
    const nextWf = workflows.find((wf) => wf.path === nextPath)
    const defaults: Record<string, string | number | boolean> = {}
    if (nextWf) {
      for (const input of nextWf.inputs) defaults[input.name] = input.defaultValue
    }
    setInputValues(defaults)
  }

  return (
    <PrototypeDialog open={open} title="手动触发流水线运行" onClose={onClose}>
      {activeWorkflow ? (
        <div className="space-y-4">
          <p className="small muted">
            触发后平台将固定所选分支的最新提交 SHA 与工作流 YAML 快照，并下发至匹配能力标签的执行节点。
          </p>

          <div className="form-grid">
            <ProtoField label="工作流" full>
              <select
                aria-label="选择工作流"
                value={activeWorkflow.path}
                onChange={(event) => handleWorkflowChange(event.target.value)}
              >
                {workflows.map((wf) => (
                  <option key={wf.path} value={wf.path}>
                    {wf.name}（{wf.path}）
                  </option>
                ))}
              </select>
            </ProtoField>

            <ProtoField label="分支 / 标签" full>
              <select
                aria-label="选择分支"
                value={selectedRef}
                onChange={(event) => setSelectedRef(event.target.value)}
              >
                {refs.map((item) => (
                  <option key={item.ref} value={item.ref}>
                    {item.ref} · {item.commitSha.slice(0, 8)} — {item.commitMessage}
                  </option>
                ))}
              </select>
            </ProtoField>
          </div>

          <div className="pl-wf-facts">
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">执行链路</span>
              <span>{activeWorkflow.jobs.map((job) => `${job.name} (${job.steps.length}步)`).join(' → ')}</span>
            </span>
            <span className="pl-wf-fact">
              <span className="pl-wf-fact-label">目标节点</span>
              <span className="mono">{activeWorkflow.runsOn.join(', ')}</span>
            </span>
          </div>

          {activeWorkflow.inputs.length > 0 && (
            <div className="space-y-2">
              <strong className="small">工作流输入参数（按 YAML 自动生成）</strong>
              <div className="pl-inputs-grid">
                {activeWorkflow.inputs.map((input) => {
                  const currentVal = inputValues[input.name] ?? input.defaultValue
                  if (input.type === 'boolean') {
                    return (
                      <label key={input.name} className="pl-switch-row" style={{ gridColumn: '1 / -1' }}>
                        <span>
                          <strong className="mono small">{input.name}</strong>
                          <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                            {input.description}
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(currentVal)}
                          onChange={(event) =>
                            setInputValues((prev) => ({ ...prev, [input.name]: event.target.checked }))
                          }
                        />
                      </label>
                    )
                  }
                  if (input.type === 'choice' && input.options) {
                    return (
                      <ProtoField key={input.name} label={`${input.name} · ${input.description}`}>
                        <select
                          value={String(currentVal)}
                          onChange={(event) =>
                            setInputValues((prev) => ({ ...prev, [input.name]: event.target.value }))
                          }
                        >
                          {input.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </ProtoField>
                    )
                  }
                  return (
                    <ProtoField key={input.name} label={`${input.name} · ${input.description}`}>
                      <input
                        type={input.type === 'number' ? 'number' : 'text'}
                        value={String(currentVal)}
                        onChange={(event) =>
                          setInputValues((prev) => ({
                            ...prev,
                            [input.name]: input.type === 'number' ? Number(event.target.value) : event.target.value,
                          }))
                        }
                      />
                    </ProtoField>
                  )
                })}
              </div>
            </div>
          )}

          <div className="form-actions">
            <ProtoButton onClick={onClose}>取消</ProtoButton>
            <ProtoButton
              variant="primary"
              onClick={() => {
                onSubmit({ workflow: activeWorkflow, ref: selectedRef, inputs: inputValues })
                onClose()
              }}
            >
              <Play size={14} aria-hidden="true" />
              立即触发运行
            </ProtoButton>
          </div>
        </div>
      ) : (
        <p className="small muted">当前没有可触发的工作流。</p>
      )}
    </PrototypeDialog>
  )
}

/**
 * 执行节点状态速览弹窗：帮助开发者判断任务为何排队或可调度到哪些节点。
 * @param props.open 打开状态。
 * @param props.nodes 执行节点列表。
 * @param props.onClose 关闭回调。
 * @returns 节点池状态对话框。
 */
export function PipelineNodesOverviewDialog({
  open,
  nodes,
  onClose,
}: {
  open: boolean
  nodes: ProtoPipelineNode[]
  onClose: () => void
}) {
  return (
    <PrototypeDialog open={open} title="自托管执行节点池" className="pl-wide-dialog" onClose={onClose}>
      <div className="space-y-4">
        <p className="small muted">
          流水线任务按工作流声明的 <code className="mono">runs-on</code>{' '}
          标签匹配在线节点并隔离执行。节点离线时任务显式排队，不会自动改派到未知环境。
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>节点名称</th>
                <th>状态</th>
                <th>系统 / 架构</th>
                <th>能力标签</th>
                <th>并发槽位</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id}>
                  <td>
                    <span className="row">
                      <Server size={14} className="quiet" aria-hidden="true" />
                      <strong>{node.name}</strong>
                    </span>
                  </td>
                  <td>
                    <span
                      className={`pl-status-badge ${
                        node.status === 'online'
                          ? 'pl-tone-success'
                          : node.status === 'busy'
                            ? 'pl-tone-running'
                            : 'pl-tone-danger'
                      }`}
                    >
                      <CheckCircle2 size={12} aria-hidden="true" />
                      {node.status === 'online' ? '在线空闲' : node.status === 'busy' ? '执行中' : '已离线'}
                    </span>
                  </td>
                  <td className="mono">
                    {node.os} / {node.arch}
                  </td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      {node.capabilities.map((cap) => (
                        <span key={cap} className="badge mono">
                          {cap}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="mono">
                    {node.runningJobs} / {node.concurrencyLimit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          <ProtoButton variant="primary" onClick={onClose}>
            关闭
          </ProtoButton>
        </div>
      </div>
    </PrototypeDialog>
  )
}
