import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import {
  ArtifactList,
  CancelRunDialog,
  LogViewer,
  RunSummary,
  StepTimeline,
  cancelPipelineRun,
  isRunActive,
  pipelineRunQueryOptions,
  useFocusReturn,
  usePipelineLogs,
} from '@/features/pipeline/public'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'

/**
 * 流水线运行详情页。
 *
 * 展示运行状态与终态原因、步骤时间线、按步骤轮询的日志、产物下载与取消操作。
 * 运行未结束时自动轮询详情与日志；取消需要二次确认，取消后等待节点确认最终状态。
 * @returns 运行详情界面；加载失败可重试，无步骤时给出等待说明。
 */
export function Component() {
  const { projectId = '', runId = '' } = useParams()
  const { role } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const cancelFocus = useFocusReturn()

  const run = useQuery(pipelineRunQueryOptions(runId))
  const detail = run.data?.run
  const activeStepIndex = selectedStepIndex ?? detail?.steps[0]?.index ?? null
  const logs = usePipelineLogs(runId, activeStepIndex, detail ? isRunActive(detail.status) : false)
  const cancel = useMutation({
    mutationFn: (reason: string) => cancelPipelineRun(runId, reason),
    onSuccess: async (result) => {
      queryClient.setQueryData(pipelineRunQueryOptions(runId).queryKey, result)
      await queryClient.invalidateQueries({ queryKey: ['pipeline', 'runs'] })
      showToast('已提交取消请求，正在等待执行节点确认。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  if (run.isPending) return <DelayedPageSkeleton />
  if (run.isError || !detail) {
    const described = describeRequestError(run.error)
    return (
      <PageError
        title="运行详情加载失败"
        description={described.description}
        requestId={described.requestId}
        retrying={run.isFetching}
        onRetry={() => void run.refetch()}
      />
    )
  }

  const canCancel = role === 'admin' || role === 'developer'
  return (
    <div className="project-tab-panel space-y-8">
      <RunSummary
        run={detail}
        projectBasePath={`/projects/${projectId}`}
        canCancel={canCancel}
        isCancelling={cancel.isPending}
        onCancel={(trigger) => {
          cancelFocus.capture(trigger)
          setCancelOpen(true)
        }}
        onRefresh={() => void run.refetch()}
        isRefreshing={run.isFetching}
      />

      <section aria-label="步骤时间线" className="space-y-3">
        <div className="section-heading">
          <h2>步骤</h2>
          <span className="counter">{detail.steps.length}</span>
        </div>
        <StepTimeline
          steps={detail.steps}
          selectedStepIndex={activeStepIndex ?? 0}
          onSelectStep={setSelectedStepIndex}
          isRunActive={isRunActive(detail.status)}
        />
      </section>

      <LogViewer
        selectedStepIndex={activeStepIndex ?? 0}
        steps={detail.steps}
        chunks={logs.chunks}
        isPending={logs.isPending}
        errorDescription={logs.errorDescription}
        requestId={logs.requestId}
        isRunActive={isRunActive(detail.status)}
        onSelectStep={setSelectedStepIndex}
        onRefresh={logs.refresh}
        hasTruncatedContent={logs.hasTruncatedContent}
      />

      <ArtifactList
        artifacts={detail.artifacts}
        isPending={false}
        errorDescription={null}
        requestId={run.data?.requestId ?? null}
        onRetry={() => void run.refetch()}
        canDownload
      />

      <CancelRunDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open)
          if (!open) cancelFocus.restore()
        }}
        runLabel={`${detail.workflowName ?? detail.workflowPath}（${detail.runId.slice(0, 8)}）`}
        isPending={cancel.isPending}
        onConfirm={(reason) => {
          setCancelOpen(false)
          cancelFocus.restore()
          cancel.mutate(reason)
        }}
      />
    </div>
  )
}

export default Component
