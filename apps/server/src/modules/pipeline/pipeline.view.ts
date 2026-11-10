import type {
  PipelineArtifactRow,
  PipelineRunListRow,
  PipelineRunLogStat,
  PipelineRunStepRow,
} from './pipeline.repository.ts'

/** 运行摘要视图；字段名对齐 contracts/rest-api.md §4.2。 */
export interface PipelineRunView {
  runId: string
  projectId: string
  repositoryId: string
  workflowPath: string
  workflowName: string | null
  ref: string
  commitSha: string
  status: string
  triggerSource: string
  initiatorChannel: string
  triggeredByUserId: string
  initiator: string
  nodeId: string | null
  nodeName: string | null
  errorCode: string | null
  errorMessage: string | null
  durationSeconds: number | null
  cancelRequestedAt: string | null
  createdAt: string
  assignedAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** 运行步骤视图；只暴露执行事实，不返回工作区路径等内部信息。 */
export interface PipelineRunStepView {
  index: number
  name: string
  kind: string
  status: string
  exitCode: number | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** 运行产物视图；downloadUrl 为受鉴权接口路径，不是公开链接。 */
export interface PipelineArtifactView {
  artifactId: string
  runId: string
  name: string
  stepIndex: number
  sizeBytes: number
  sha256: string
  status: string
  createdAt: string
  downloadUrl: string
}

/** 日志分片聚合元数据视图；正文通过日志接口按需读取。 */
export interface PipelineRunLogStatView {
  stepIndex: number
  chunkCount: number
  sizeBytes: number
  lastSeq: number
}

/** 运行详情视图；包含输入摘要、发起人、节点摘要、步骤、产物与日志元数据。 */
export interface PipelineRunDetailView extends PipelineRunView {
  inputs: Record<string, string | number | boolean | null>
  steps: PipelineRunStepView[]
  artifacts: PipelineArtifactView[]
  logs: { items: PipelineRunLogStatView[]; totalSizeBytes: number }
}

/** 节点视图；不返回令牌明文或哈希。 */
export interface PipelineNodeView {
  nodeId: string
  teamId: string
  name: string
  status: string
  os: string
  arch: string
  capabilities: string[]
  concurrencyLimit: number
  agentVersion: string | null
  lastHeartbeatAt: string | null
  lastErrorCode: string | null
  currentRunId: string | null
  disabledAt: string | null
  createdAt: string
}

/** 工作流解析错误视图；字段名对齐 rest-api.md §3.1。 */
export interface PipelineWorkflowParseErrorView {
  code: string
  message: string
  fieldPath?: string
  line?: number
  column?: number
}

/** 工作流最近一次运行摘要。 */
export interface PipelineWorkflowLastRunView {
  runId: string
  status: string
  createdAt: string
}

/** 工作流列表项。 */
export interface PipelineWorkflowItemView {
  path: string
  name: string
  valid: boolean
  parseErrors: PipelineWorkflowParseErrorView[]
  lastRun: PipelineWorkflowLastRunView | null
}

/** 工作流列表视图。 */
export interface PipelineWorkflowListView {
  ref: string
  commitSha: string
  items: PipelineWorkflowItemView[]
}

/** 运行计划摘要；只展示 job 与步骤名称，不返回镜像、环境变量与密钥引用。 */
export interface PipelineWorkflowPlanSummaryView {
  jobs: Array<{
    id: string
    name: string
    steps: Array<{ index: number; name: string; kind: string }>
  }>
}

/** 工作流手动触发输入声明；用于前端渲染触发表单，不含运行时取值。 */
export interface PipelineWorkflowInputView {
  name: string
  type: string
  required: boolean
  defaultValue?: string | number | boolean
  options?: string[]
  description?: string
}

/** 工作流详情视图；content 为固定 ref 上的原始 YAML。 */
export interface PipelineWorkflowDetailView {
  path: string
  name: string
  repositoryId: string
  ref: string
  commitSha: string
  content: string
  contentHash: string
  valid: boolean
  parseErrors: PipelineWorkflowParseErrorView[]
  planSummary: PipelineWorkflowPlanSummaryView | null
  inputs: PipelineWorkflowInputView[]
}

/** 日志读取项视图。 */
export interface PipelineLogItemView {
  seq: number
  content: string
  truncated: boolean
}

/** 日志读取响应视图。 */
export interface PipelineLogReadView {
  stepIndex: number | null
  items: PipelineLogItemView[]
  nextSeq: number
  hasMore: boolean
}

/** 分页视图。 */
export interface PipelinePageView<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

/** 运行视图映射的额外展示信息；由 service 批量查询后注入，避免 view 依赖数据库。 */
export interface PipelineRunViewExtras {
  initiator: string
  nodeName: string | null
  now?: Date
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** 计算运行耗时（秒）；未开始返回 null，进行中按当前时间计算。 */
function durationSecondsOf(row: PipelineRunListRow, now: Date): number | null {
  const start = row.started_at ?? row.assigned_at ?? row.created_at
  if (!start) return null
  const end = row.finished_at ?? now
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000))
}

/**
 * 将运行行映射为契约摘要视图。
 * @param row 运行摘要行。
 * @param extras 发起人展示名、节点名与计算耗时用的当前时间。
 * @returns 不包含运行计划、工作流快照与密钥引用的响应视图。
 */
export function toPipelineRunView(row: PipelineRunListRow, extras: PipelineRunViewExtras): PipelineRunView {
  return {
    runId: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    workflowPath: row.workflow_path,
    workflowName: row.workflow_name,
    ref: row.git_ref,
    commitSha: row.commit_sha,
    status: row.status,
    triggerSource: row.trigger_source,
    initiatorChannel: row.initiator_channel,
    triggeredByUserId: row.triggered_by_user_id,
    initiator: extras.initiator,
    nodeId: row.node_id,
    nodeName: extras.nodeName,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    durationSeconds: durationSecondsOf(row, extras.now ?? new Date()),
    cancelRequestedAt: toIso(row.cancel_requested_at),
    createdAt: toIso(row.created_at) ?? '',
    assignedAt: toIso(row.assigned_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  }
}

/** 将步骤行映射为视图。 */
export function toPipelineRunStepView(row: PipelineRunStepRow): PipelineRunStepView {
  return {
    index: row.step_index,
    name: row.name,
    kind: row.kind,
    status: row.status,
    exitCode: row.exit_code,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  }
}

/** 将产物行映射为视图；downloadUrl 指向受鉴权下载接口。 */
export function toPipelineArtifactView(row: PipelineArtifactRow): PipelineArtifactView {
  return {
    artifactId: row.id,
    runId: row.run_id,
    name: row.name,
    stepIndex: row.step_index,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    status: row.status,
    createdAt: toIso(row.created_at) ?? '',
    downloadUrl: `/api/v1/pipeline-artifacts/${row.id}/download`,
  }
}

/** 将日志聚合行映射为视图。 */
export function toPipelineRunLogStatView(row: PipelineRunLogStat): PipelineRunLogStatView {
  return {
    stepIndex: row.stepIndex,
    chunkCount: row.chunkCount,
    sizeBytes: row.sizeBytes,
    lastSeq: row.lastSeq,
  }
}

/** 构造分页视图。 */
export function pipelinePageView<T>(items: T[], page: number, pageSize: number, total: number): PipelinePageView<T> {
  return { items, page, pageSize, total }
}
