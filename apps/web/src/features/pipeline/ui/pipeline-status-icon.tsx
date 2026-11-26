import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, Loader2, SkipForward, XCircle } from 'lucide-react'
import { runStatusLabel, stepStatusLabel } from '../lib/status'
import type { PipelineRunStatus, PipelineStepDisplayStatus } from '../model/types'

/** 状态视觉色调；对应 pipeline.css 中的语义 token 类名。 */
export type PipelineVisualTone = 'success' | 'running' | 'warning' | 'danger' | 'neutral'

/**
 * 将运行或步骤状态映射到视觉语义色。
 * @param status 运行或步骤状态。
 * @returns 语义色标识。
 */
export function pipelineVisualTone(status: PipelineRunStatus | PipelineStepDisplayStatus): PipelineVisualTone {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'running':
    case 'assigned':
      return 'running'
    case 'queued':
    case 'cancelling':
      return 'warning'
    case 'failed':
    case 'interrupted':
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * 获取展示层步骤状态的中文文案（包含运行中断时映射出的“已中断”）。
 * @param status 步骤展示状态。
 * @returns 中文文案。
 */
export function stepDisplayStatusLabel(status: PipelineStepDisplayStatus): string {
  if (status === 'interrupted') return '已中断'
  return stepStatusLabel(status)
}

/**
 * 渲染统一语义的运行或步骤状态图标，确保颜色不单独承载状态信息。
 * @param props.status 运行或步骤展示状态。
 * @param props.size 图标像素尺寸，默认 15。
 * @returns 状态图标元素。
 */
export function PipelineStatusIcon({
  status,
  size = 15,
}: {
  status: PipelineRunStatus | PipelineStepDisplayStatus
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
 * 渲染带图标与中文文案的运行状态徽标。
 * @param props.status 运行状态。
 * @returns 状态徽标元素。
 */
export function PipelineRunStatusBadge({ status }: { status: PipelineRunStatus }) {
  const tone = pipelineVisualTone(status)
  return (
    <span className={`pl-status-badge pl-tone-${tone}`}>
      <PipelineStatusIcon status={status} size={13} />
      <span>{runStatusLabel(status)}</span>
    </span>
  )
}
