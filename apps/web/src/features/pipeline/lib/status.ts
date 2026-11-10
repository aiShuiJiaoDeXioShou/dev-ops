import type { PipelineArtifactStatus, PipelineNodeStatus, PipelineRunStatus, PipelineStepStatus } from '../model/types'

/** 状态语义色；只用于 `StatusLabel` 选择状态点颜色，颜色值来自 token。 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const RUN_STATUS_LABELS: Record<PipelineRunStatus, string> = {
  queued: '排队中',
  assigned: '已分配',
  running: '运行中',
  cancelling: '取消中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
}

const RUN_STATUS_TONES: Record<PipelineRunStatus, StatusTone> = {
  queued: 'neutral',
  assigned: 'info',
  running: 'info',
  cancelling: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  interrupted: 'danger',
}

const STEP_STATUS_LABELS: Record<PipelineStepStatus, string> = {
  pending: '等待',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
}

const STEP_STATUS_TONES: Record<PipelineStepStatus, StatusTone> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  skipped: 'neutral',
  cancelled: 'neutral',
}

const NODE_STATUS_LABELS: Record<PipelineNodeStatus, string> = {
  pending: '待注册',
  online: '在线',
  draining: '排空中',
  offline: '离线',
  disabled: '已停用',
}

const NODE_STATUS_TONES: Record<PipelineNodeStatus, StatusTone> = {
  pending: 'warning',
  online: 'success',
  draining: 'warning',
  offline: 'danger',
  disabled: 'neutral',
}

const ARTIFACT_STATUS_LABELS: Record<PipelineArtifactStatus, string> = {
  available: '可下载',
  missing: '文件缺失',
  failed: '上传失败',
}

const ARTIFACT_STATUS_TONES: Record<PipelineArtifactStatus, StatusTone> = {
  available: 'success',
  missing: 'warning',
  failed: 'danger',
}

const TERMINAL_RUN_STATUSES: ReadonlySet<PipelineRunStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
])

/**
 * 判断文本是否为契约规定的运行状态。
 *
 * 接口与数据库里的状态都是 text，进入展示层前必须收窄，
 * 不用 `as` 断言把未知文本伪装成业务状态。
 * @param value 候选文本。
 * @returns 是否为合法运行状态。
 */
export function isPipelineRunStatus(value: string): value is PipelineRunStatus {
  return Object.hasOwn(RUN_STATUS_LABELS, value)
}

/** 判断文本是否为契约规定的步骤状态。 */
export function isPipelineStepStatus(value: string): value is PipelineStepStatus {
  return Object.hasOwn(STEP_STATUS_LABELS, value)
}

/** 判断文本是否为契约规定的节点状态。 */
export function isPipelineNodeStatus(value: string): value is PipelineNodeStatus {
  return Object.hasOwn(NODE_STATUS_LABELS, value)
}

/** 判断文本是否为契约规定的产物状态。 */
export function isPipelineArtifactStatus(value: string): value is PipelineArtifactStatus {
  return Object.hasOwn(ARTIFACT_STATUS_LABELS, value)
}

/**
 * 判断运行是否处于终态；终态不再轮询日志，也不能取消。
 * @param status 运行状态。
 * @returns 是否为 succeeded/failed/cancelled/interrupted。
 */
export function isTerminalRunStatus(status: PipelineRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status)
}

/**
 * 判断当前运行是否可发起取消；与接口契约一致。
 * @param status 运行状态。
 * @returns queued/assigned/running 时为 true；cancelling 与终态为 false。
 */
export function canCancelRunStatus(status: PipelineRunStatus): boolean {
  return status === 'queued' || status === 'assigned' || status === 'running'
}

/**
 * 判断运行是否仍在推进，用于决定日志轮询是否继续。
 * @param status 运行状态。
 * @returns 非终态时为 true。
 */
export function isRunActive(status: PipelineRunStatus): boolean {
  return !isTerminalRunStatus(status)
}

/**
 * 运行状态中文文案。
 * @param status 运行状态文本；未知文本原样返回，避免出现空白状态。
 * @returns 中文文案。
 */
export function runStatusLabel(status: string): string {
  return isPipelineRunStatus(status) ? RUN_STATUS_LABELS[status] : status
}

/**
 * 运行状态语义色。
 * @param status 运行状态文本；未知文本使用中性色。
 * @returns 状态点语义色。
 */
export function runStatusTone(status: string): StatusTone {
  return isPipelineRunStatus(status) ? RUN_STATUS_TONES[status] : 'neutral'
}

/**
 * 步骤状态中文文案。
 * @param status 步骤状态文本；未知文本原样返回。
 * @returns 中文文案。
 */
export function stepStatusLabel(status: string): string {
  return isPipelineStepStatus(status) ? STEP_STATUS_LABELS[status] : status
}

/**
 * 步骤状态语义色。
 * @param status 步骤状态文本；未知文本使用中性色。
 * @returns 状态点语义色。
 */
export function stepStatusTone(status: string): StatusTone {
  return isPipelineStepStatus(status) ? STEP_STATUS_TONES[status] : 'neutral'
}

/**
 * 节点状态中文文案。
 * @param status 节点状态文本；未知文本原样返回。
 * @returns 中文文案。
 */
export function nodeStatusLabel(status: string): string {
  return isPipelineNodeStatus(status) ? NODE_STATUS_LABELS[status] : status
}

/**
 * 节点状态语义色。
 * @param status 节点状态文本；未知文本使用中性色。
 * @returns 状态点语义色。
 */
export function nodeStatusTone(status: string): StatusTone {
  return isPipelineNodeStatus(status) ? NODE_STATUS_TONES[status] : 'neutral'
}

/**
 * 产物状态中文文案。
 * @param status 产物状态文本；未知文本原样返回。
 * @returns 中文文案。
 */
export function artifactStatusLabel(status: string): string {
  return isPipelineArtifactStatus(status) ? ARTIFACT_STATUS_LABELS[status] : status
}

/**
 * 产物状态语义色。
 * @param status 产物状态文本；未知文本使用中性色。
 * @returns 状态点语义色。
 */
export function artifactStatusTone(status: string): StatusTone {
  return isPipelineArtifactStatus(status) ? ARTIFACT_STATUS_TONES[status] : 'neutral'
}

/** 运行筛选中可选的状态值；顺序即下拉选项顺序。 */
export const RUN_FILTER_STATUSES: PipelineRunStatus[] = [
  'queued',
  'assigned',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]
