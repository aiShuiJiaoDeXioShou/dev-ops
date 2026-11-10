import { Button } from '@/shared/ui/controls/button'
import { formatDateTime } from '@/shared/lib/format'
import { formatDurationSeconds } from '../lib/format'
import { stepStatusLabel, stepStatusTone } from '../lib/status'
import type { PipelineRunStep } from '../model/types'
import { StatusLabel } from './status-label'

/** 步骤类型展示文案；内置动作与普通命令区分显示。 */
const STEP_KIND_LABELS: Record<string, string> = {
  run: '命令',
  builtin_checkout: '检出代码',
  builtin_upload_artifact: '上传产物',
}

/** 计算步骤耗时；缺少开始时间返回 null。 */
function stepDurationSeconds(step: PipelineRunStep): number | null {
  if (!step.startedAt) return null
  const started = new Date(step.startedAt).getTime()
  if (Number.isNaN(started)) return null
  const finished = step.finishedAt ? new Date(step.finishedAt).getTime() : Date.now()
  if (Number.isNaN(finished) || finished < started) return null
  return Math.floor((finished - started) / 1000)
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
}

/**
 * 步骤时间线。
 *
 * 每个步骤展示状态、耗时、退出码与失败摘要；点击“查看日志”把日志面板切换到该步骤。
 * 失败步骤保留错误说明，取消/跳过与失败在文案与语义色上可区分。
 * @param props 步骤数据、日志选择状态与运行活跃性。
 * @returns 步骤列表；没有步骤时说明运行尚未开始。
 */
export function StepTimeline({ steps, selectedStepIndex, onSelectStep, isRunActive }: StepTimelineProps) {
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
        return (
          <li key={step.index} className="card">
            <div className="row spread">
              <div className="row">
                <span className="counter">{step.index + 1}</span>
                <strong>{step.name}</strong>
                <span className="badge">{STEP_KIND_LABELS[step.kind] ?? step.kind}</span>
                <StatusLabel tone={stepStatusTone(step.status)}>{stepStatusLabel(step.status)}</StatusLabel>
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
