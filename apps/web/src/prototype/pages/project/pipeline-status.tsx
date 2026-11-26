import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, Loader2, SkipForward, XCircle } from 'lucide-react'
import type { ProtoPipelineRunStatus, ProtoPipelineStepKind, ProtoPipelineStepStatus } from '@/prototype/data/pipelines'

/** 语义状态色键，对应 pipelines.css 中的状态变量。 */
export type ProtoPipelineTone = 'success' | 'running' | 'warning' | 'danger' | 'neutral'

const RUN_STATUS_META: Record<ProtoPipelineRunStatus, { label: string; tone: ProtoPipelineTone }> = {
  queued: { label: '排队中', tone: 'warning' },
  assigned: { label: '已分配', tone: 'running' },
  running: { label: '运行中', tone: 'running' },
  cancelling: { label: '取消中', tone: 'warning' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
  interrupted: { label: '已中断', tone: 'danger' },
}

const STEP_STATUS_META: Record<ProtoPipelineStepStatus, { label: string; tone: ProtoPipelineTone }> = {
  pending: { label: '等待中', tone: 'neutral' },
  running: { label: '运行中', tone: 'running' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  skipped: { label: '已跳过', tone: 'neutral' },
  cancelled: { label: '已取消', tone: 'neutral' },
  interrupted: { label: '已中断', tone: 'danger' },
}

const STEP_KIND_META: Record<ProtoPipelineStepKind, string> = {
  builtin_checkout: '检出代码',
  run: '命令',
  builtin_upload_artifact: '上传产物',
}

/**
 * 获取运行状态的中文文案与语义色。
 * @param status 运行状态枚举。
 * @returns 展示文案与语义色标识。
 */
export function getRunStatusMeta(status: ProtoPipelineRunStatus): { label: string; tone: ProtoPipelineTone } {
  return RUN_STATUS_META[status]
}

/**
 * 获取步骤状态的中文文案与语义色。
 * @param status 步骤状态枚举。
 * @returns 展示文案与语义色标识。
 */
export function getStepStatusMeta(status: ProtoPipelineStepStatus): { label: string; tone: ProtoPipelineTone } {
  return STEP_STATUS_META[status]
}

/**
 * 获取步骤类型的中文标签。
 * @param kind 步骤类型。
 * @returns 面向开发者的简短标签。
 */
export function getStepKindLabel(kind: ProtoPipelineStepKind): string {
  return STEP_KIND_META[kind]
}

/**
 * 判断运行是否仍处于未结束状态。
 * @param status 运行状态。
 * @returns 处于排队、分配、运行或取消中时返回 true。
 */
export function isProtoRunActive(status: ProtoPipelineRunStatus): boolean {
  return status === 'queued' || status === 'assigned' || status === 'running' || status === 'cancelling'
}

/**
 * 格式化耗时秒数为易读中文时长。
 * @param seconds 秒数；尚未开始或无数据时为 null。
 * @returns 如“12 秒”“1 分 52 秒”，无值时返回“—”。
 */
export function formatProtoDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—'
  if (seconds < 60) return `${seconds} 秒`
  const mins = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${mins} 分` : `${mins} 分 ${rest} 秒`
}

/**
 * 格式化紧凑耗时（用于列表阶段胶囊与步骤导航），保持横向空间克制。
 * @param seconds 秒数。
 * @returns 如“12s”“1m 40s”，无值时返回空字符串。
 */
export function formatCompactDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return ''
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`
}

/**
 * 渲染统一语义的运行/步骤状态图标，不依赖纯颜色传达状态。
 * @param props.status 运行或步骤状态；props.size 图标像素尺寸。
 * @returns 语义状态图标元素。
 */
export function PipelineStatusIcon({
  status,
  size = 15,
}: {
  status: ProtoPipelineRunStatus | ProtoPipelineStepStatus
  size?: number
}) {
  const common = { size, 'aria-hidden': true as const }
  switch (status) {
    case 'succeeded':
      return <CheckCircle2 {...common} className="pl-icon pl-tone-success" />
    case 'failed':
      return <XCircle {...common} className="pl-icon pl-tone-danger" />
    case 'interrupted':
      return <AlertTriangle {...common} className="pl-icon pl-tone-danger" />
    case 'running':
    case 'assigned':
      return <Loader2 {...common} className="pl-icon pl-tone-running pl-spin" />
    case 'queued':
    case 'cancelling':
      return <Clock {...common} className="pl-icon pl-tone-warning" />
    case 'skipped':
      return <SkipForward {...common} className="pl-icon pl-tone-neutral" />
    case 'cancelled':
      return <Ban {...common} className="pl-icon pl-tone-neutral" />
    case 'pending':
    default:
      return <Circle {...common} className="pl-icon pl-tone-neutral" />
  }
}

/**
 * 渲染带图标和文字的语义状态胶囊。
 * @param props.status 运行状态。
 * @returns 同时包含图标与中文文案的胶囊元素。
 */
export function RunStatusBadge({ status }: { status: ProtoPipelineRunStatus }) {
  const meta = getRunStatusMeta(status)
  return (
    <span className={`pl-status-badge pl-tone-${meta.tone}`}>
      <PipelineStatusIcon status={status} size={13} />
      <span>{meta.label}</span>
    </span>
  )
}
