import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { PageError } from '@/shared/ui/page-state'
import type { PipelineLogChunk, PipelineRunStep } from '../model/types'

interface LogViewerProps {
  /** 当前查看的步骤序号。 */
  selectedStepIndex: number
  /** 步骤列表，用于日志过滤下拉。 */
  steps: PipelineRunStep[]
  /** 已收集的日志分片，按 seq 升序。 */
  chunks: PipelineLogChunk[]
  /** 首次读取是否仍在进行。 */
  isPending: boolean
  /** 读取失败说明；非空时保留已加载内容并给出重试。 */
  errorDescription: string | null
  /** 请求标识，便于排障。 */
  requestId: string | null
  /** 运行是否仍在推进；运行中提示日志自动刷新。 */
  isRunActive: boolean
  /** 切换日志步骤。 */
  onSelectStep: (stepIndex: number) => void
  /** 重新读取当前步骤日志。 */
  onRefresh: () => void
  /** 是否有分片被截断或达到日志上限。 */
  hasTruncatedContent: boolean
}

/**
 * 运行日志面板。
 *
 * 按步骤读取日志；运行中自动追加并说明轮询状态，结束后展示完整历史日志。
 * 读取失败时保留已加载内容，提供重新读取入口。日志按分片顺序拼接为纯文本，不做 HTML 注入。
 * @param props 日志分片、步骤选择、加载与错误状态。
 * @returns 日志区域；无步骤时说明运行尚未开始。
 */
export function LogViewer({
  selectedStepIndex,
  steps,
  chunks,
  isPending,
  errorDescription,
  requestId,
  isRunActive,
  onSelectStep,
  onRefresh,
  hasTruncatedContent,
}: LogViewerProps) {
  const content = chunks.map((chunk) => chunk.content).join('')
  const statusText = isRunActive ? '运行中，日志会自动刷新。' : '运行已结束，展示完整历史日志。'
  const hasContent = content.length > 0
  return (
    <section aria-label="运行日志" className="space-y-3">
      <div className="section-heading">
        <h2>运行日志</h2>
        {chunks.length > 0 && <span className="counter">{chunks.length} 片</span>}
        <span className="spacer" />
        {steps.length > 0 && (
          <label className="row small">
            步骤
            <Select
              aria-label="按步骤筛选日志"
              value={String(selectedStepIndex)}
              onChange={(event) => onSelectStep(Number(event.target.value))}
            >
              {steps.map((step) => (
                <option key={step.index} value={String(step.index)}>
                  {step.index + 1}. {step.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={isPending}>
          <RefreshCw aria-hidden="true" />
          {isPending ? '读取中…' : '重新读取'}
        </Button>
      </div>

      <p className="small quiet">{statusText}</p>

      {steps.length === 0 ? (
        <p className="section-note">
          {isRunActive ? '运行尚未开始执行，步骤日志会在节点开始执行后显示。' : '本次运行没有步骤记录，暂无日志。'}
        </p>
      ) : errorDescription !== null && !hasContent ? (
        <PageError title="日志读取失败" description={errorDescription} requestId={requestId} onRetry={onRefresh} />
      ) : hasContent ? (
        <>
          <pre className="code max-h-96 min-h-60 overflow-auto" aria-label="运行日志内容">
            {content}
          </pre>
          {errorDescription !== null && (
            <Alert variant="destructive">
              <AlertTitle>日志读取中断</AlertTitle>
              <AlertDescription>
                <p>{errorDescription}</p>
                {requestId && <p className="small">请求标识：{requestId}</p>}
                <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                  重新读取
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </>
      ) : isPending ? (
        <p className="section-note" role="status">
          日志加载中…
        </p>
      ) : (
        <p className="section-note">{isRunActive ? '当前还没有日志输出，请稍候。' : '当前步骤没有日志输出。'}</p>
      )}

      {hasTruncatedContent && (
        <p className="section-note" role="note">
          日志超过单分片或总量上限，已展示截断后的内容。
        </p>
      )}
    </section>
  )
}
