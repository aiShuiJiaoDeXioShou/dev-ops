import { Button } from '@/shared/ui/controls/button'
import { formatDateTime } from '@/shared/lib/format'
import { formatDurationSeconds } from '../lib/format'
import { stepStatusLabel, stepStatusTone, type StatusTone } from '../lib/status'
import type { PipelineRunStatus, PipelineRunStep } from '../model/types'
import { StatusLabel } from './status-label'

/** 步骤类型展示文案；内置动作与普通命令区分显示。 */
const STEP_KIND_LABELS: Record<string, string> = {
  run: '命令',
  builtin_checkout: '检出代码',
  builtin_upload_artifact: '上传产物',
}

/**
 * 计算步骤耗时；只有结束时间存在时才算耗时。
 * 未结束步骤（运行中断/取消遗留 running）不能按当前时间累计，否则会显示成不断增长的假耗时。
 * @param step 步骤数据。
 * @returns 秒数；未结束或时间非法时返回 null。
 */
function stepDurationSeconds(step: PipelineRunStep): number | null {
  if (!step.startedAt || !step.finishedAt) return null
  const started = new Date(step.startedAt).getTime()
  const finished = new Date(step.finishedAt).getTime()
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) return null
  return Math.floor((finished - started) / 1000)
}

/**
 * 把步骤状态与运行终态结合成展示状态。
 * 运行被中断或取消时，仍停留在 running 的步骤实际已不可能继续执行，展示上归入对应终态，避免误导为仍在运行。
 * @param step 步骤数据。
 * @param runStatus 运行状态。
 * @returns 展示文案与语义色。
 */
function displayStepStatus(step: PipelineRunStep, runStatus: PipelineRunStatus): { label: string; tone: StatusTone } {
  if (step.status === 'running' && runStatus === 'interrupted') return { label: '已中断', tone: 'danger' }
  if (step.status === 'running' && runStatus === 'cancelled') return { label: '已取消', tone: 'neutral' }
  return { label: stepStatusLabel(step.status), tone: stepStatusTone(step.status) }
}

interface StepTimelineProps {
  /** 运行内步骤，按 index 升序。 */
  steps: PipelineRunStep[]
  /** 当前查看日志的步骤序号。 */
  selectedStepIndex: number
  /** 选择要查看日志的步骤。 */
  onSelectStep: (stepIndex: number) => void
  /** 运行是否仍在推进；未开始时给出等待说明。 */
  isRunActive: boolean
  /** 运行状态；用于把中断/取消后遗留的 running 步骤展示为对应终态。 */
  runStatus: PipelineRunStatus
}

/**
 * 步骤时间线。
 *
 * 每个步骤展示状态、耗时、退出码与失败摘要；点击“查看日志”把日志面板切换到该步骤。
 * 失败步骤保留错误说明，取消/跳过与失败在文案与语义色上可区分。
 * @param props 步骤数据、日志选择状态与运行活跃性。
 * @returns 步骤列表；没有步骤时说明运行尚未开始。
 */
export function StepTimeline({ steps, selectedStepIndex, onSelectStep, isRunActive, runStatus }: StepTimelineProps) {
  if (steps.length === 0) {
    return (
      <p className="section-note">
        {isRunActive ? '运行尚未开始执行，步骤会在节点领取任务后显示。' : '本次运行没有步骤记录。'}
      </p>
    )
  }
  return (
    <ol className="plain-list" aria-label="运行步骤时间线">
      {steps.map((step) => {
        const isSelected = selectedStepIndex === step.index
        const display = displayStepStatus(step, runStatus)
        return (
          <li key={step.index} className="card">
            <div className="row spread">
              <div className="row">
                <span className="counter">{step.index + 1}</span>
                <strong>{step.name}</strong>
                <span className="badge">{STEP_KIND_LABELS[step.kind] ?? step.kind}</span>
                <StatusLabel tone={display.tone}>{display.label}</StatusLabel>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isSelected}
                onClick={() => onSelectStep(step.index)}
              >
                {isSelected ? '正在查看日志' : '查看日志'}
              </Button>
            </div>
            <div className="row small quiet">
              <span>开始：{formatDateTime(step.startedAt)}</span>
              <span>结束：{formatDateTime(step.finishedAt)}</span>
              <span>耗时：{formatDurationSeconds(stepDurationSeconds(step))}</span>
              {step.exitCode !== null && <span>退出码：{step.exitCode}</span>}
            </div>
            {step.errorMessage && (
              <p className="small" role="note">
                失败原因：{step.errorMessage}
                {step.errorCode ? `（${step.errorCode}）` : ''}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
