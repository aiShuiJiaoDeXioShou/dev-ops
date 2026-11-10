/**
 * 流水线前端视图模型。
 *
 * 视图模型按 `specs/005-v04a-pipeline-runner/contracts/rest-api.md` 的对外字段定义，
 * 与数据库列解耦：接口模块负责把生成客户端返回的数据映射到这里，
 * 展示组件只依赖稳定的业务字段，避免服务端表结构变化直接扩散到页面。
 */

/** 运行状态；与 data-model 的状态机一致。 */
export type PipelineRunStatus =
  'queued' | 'assigned' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

/** 运行内步骤状态。 */
export type PipelineStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'

/** 执行节点状态。 */
export type PipelineNodeStatus = 'pending' | 'online' | 'draining' | 'offline' | 'disabled'

/** 产物可用状态；只有 available 的产物允许下载。 */
export type PipelineArtifactStatus = 'available' | 'missing' | 'failed'

/** 工作流解析错误；行号与字段路径至少给出一个，便于定位。 */
export interface PipelineWorkflowParseError {
  code: string
  message: string
  fieldPath: string | null
  line: number | null
  column: number | null
}

/** 工作流最近一次运行摘要。 */
export interface PipelineWorkflowLastRun {
  runId: string
  status: PipelineRunStatus
  createdAt: string
}

/** 工作流列表项：解析状态决定是否允许触发。 */
export interface PipelineWorkflowSummary {
  path: string
  name: string | null
  valid: boolean
  parseErrors: PipelineWorkflowParseError[]
  lastRun: PipelineWorkflowLastRun | null
}

/** 指定 ref 下的工作流列表与固定提交。 */
export interface PipelineWorkflowList {
  ref: string
  commitSha: string
  items: PipelineWorkflowSummary[]
}

/** 运行列表摘要。 */
export interface PipelineRunSummary {
  runId: string
  workflowPath: string
  workflowName: string | null
  ref: string
  commitSha: string
  status: PipelineRunStatus
  /** 发起人的展示名；接口只返回标识时由接口层兜底成“未知成员”。 */
  initiator: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationSeconds: number | null
}

/** 运行步骤执行事实。 */
export interface PipelineRunStep {
  index: number
  name: string
  kind: string
  status: PipelineStepStatus
  exitCode: number | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** 产物元数据；downloadUrl 由接口层按权限签发，页面不得自行拼接。 */
export interface PipelineRunArtifact {
  artifactId: string
  name: string
  stepIndex: number
  sizeBytes: number
  sha256: string
  status: PipelineArtifactStatus
  createdAt: string
  downloadUrl: string | null
}

/** 运行级日志统计；详情接口按步骤返回日志分片数量与字节数。 */
export interface PipelineLogStat {
  stepIndex: number
  chunkCount: number
  sizeBytes: number
  lastSeq: number
}

/** 触发运行时的输入值；null 表示工作流声明的默认值。 */
export type PipelineRunDetailInputValue = string | number | boolean | null

/** 运行详情：摘要 + 步骤 + 产物 + 日志统计 + 终态原因。 */
export interface PipelineRunDetail extends PipelineRunSummary {
  triggerSource: string
  initiatorChannel: string
  nodeId: string | null
  nodeName: string | null
  errorCode: string | null
  errorMessage: string | null
  cancelRequestedAt: string | null
  inputs: Record<string, PipelineRunDetailInputValue>
  steps: PipelineRunStep[]
  artifacts: PipelineRunArtifact[]
  logs: PipelineLogStat[]
}

/** 日志分片；seq 同一步骤内单调递增，重复 seq 由服务端幂等忽略。 */
export interface PipelineLogChunk {
  seq: number
  content: string
  truncated: boolean
}

/** 一次日志读取结果；stepIndex 为空表示未限定步骤的合并读取。 */
export interface PipelineLogPage {
  stepIndex: number | null
  items: PipelineLogChunk[]
  nextSeq: number
  hasMore: boolean
}

/** 执行节点视图。 */
export interface PipelineNode {
  nodeId: string
  name: string
  status: PipelineNodeStatus
  os: string
  arch: string
  capabilities: string[]
  concurrencyLimit: number
  agentVersion: string | null
  lastHeartbeatAt: string | null
  currentRunId: string | null
  createdAt: string
}

/** 新建节点结果：注册令牌只出现一次，页面必须提示立即复制。 */
export interface PipelineNodeRegistration {
  node: PipelineNode
  registrationToken: string
  expiresAt: string | null
}

/** 轮换令牌结果：新 Agent 令牌只出现一次。 */
export interface PipelineNodeToken {
  token: string
  expiresAt: string | null
}

/** 触发运行的输入值；具体类型受工作流声明约束，前端不额外猜测。 */
export type PipelineRunInputValue = string | number | boolean

/** 触发运行的入参；幂等键由前端生成并允许用户复用。 */
export interface TriggerRunInput {
  workflowPath: string
  ref: string
  inputs: Record<string, PipelineRunInputValue>
  idempotencyKey: string
}

/** 运行历史筛选条件；空字符串表示不筛选。 */
export interface PipelineRunFilters {
  workflowPath: string
  status: PipelineRunStatus | ''
  from: string
  to: string
}
