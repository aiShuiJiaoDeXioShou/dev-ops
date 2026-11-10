import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import {
  RunHistory,
  TriggerRunDialog,
  WorkflowList,
  parseRunFilters,
  parseRunPage,
  pipelineRunsQueryOptions,
  pipelineWorkflowsQueryOptions,
  serializeRunFilters,
  triggerPipelineRun,
  useFocusReturn,
  type PipelineRunListQuery,
  type PipelineWorkflowSummary,
  type TriggerRunInput,
} from '@/features/pipeline/public'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'

/** 运行历史每页条数；与服务端默认值保持接近，便于分页浏览。 */
const RUN_PAGE_SIZE = 20

/**
 * 把 URL 筛选条件转换为运行列表查询参数；空值不传给接口。
 * @param filters 视图筛选条件。
 * @param page 当前页码。
 * @returns 运行列表接口查询参数。
 */
function toRunListQuery(filters: ReturnType<typeof parseRunFilters>, page: number): PipelineRunListQuery {
  return {
    page,
    pageSize: RUN_PAGE_SIZE,
    ...(filters.workflowPath ? { workflowPath: filters.workflowPath } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  }
}

/**
 * 项目流水线页。
 *
 * 展示仓库工作流与解析结果、运行历史与筛选，并允许开发者/管理员手动触发运行。
 * 筛选条件写入 URL，刷新与返回可恢复；解析失败与仓库不可用分别展示，不互相冒充。
 */
export function Component() {
  const { projectId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { role } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [triggerPath, setTriggerPath] = useState<string | null>(null)
  const triggerFocus = useFocusReturn()

  const filters = useMemo(() => parseRunFilters(searchParams), [searchParams])
  const page = parseRunPage(searchParams)
  const runQuery = toRunListQuery(filters, page)
  const workflows = useQuery(pipelineWorkflowsQueryOptions(projectId))
  const runs = useQuery(pipelineRunsQueryOptions(projectId, runQuery))
  const canTrigger = role === 'admin' || role === 'developer'
  const validWorkflows: PipelineWorkflowSummary[] = workflows.data?.items.filter((item) => item.valid) ?? []

  const trigger = useMutation({
    mutationFn: (input: TriggerRunInput) => triggerPipelineRun(projectId, input),
    onSuccess: async (result) => {
      setTriggerPath(null)
      triggerFocus.restore()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pipeline', 'runs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline', 'workflows', projectId] }),
      ])
      showToast(`运行已创建：${result.run.runId.slice(0, 8)}`, 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const applyFilters = (next: typeof filters) => {
    setSearchParams(new URLSearchParams(serializeRunFilters(next, 1)))
  }
  const clearFilters = () => {
    setSearchParams(new URLSearchParams())
  }
  const changePage = (nextPage: number) => {
    setSearchParams(new URLSearchParams(serializeRunFilters(filters, nextPage)))
  }

  const workflowOptions =
    workflows.data?.items.map((item) => ({
      path: item.path,
      label: item.name ?? item.path,
    })) ?? []
  const runsError = runs.isError ? describeRequestError(runs.error) : null

  return (
    <div className="project-tab-panel space-y-8">
      <h1 className="sr-only">流水线</h1>

      {workflows.isPending ? (
        <DelayedLoading pending>
          <PageLoading message="工作流加载中…" />
        </DelayedLoading>
      ) : workflows.isError ? (
        <PageError
          title="工作流读取失败"
          description={describeRequestError(workflows.error).description}
          requestId={describeRequestError(workflows.error).requestId}
          retrying={workflows.isFetching}
          onRetry={() => void workflows.refetch()}
        />
      ) : (
        <WorkflowList
          workflows={workflows.data.items}
          refName={workflows.data.ref}
          commitSha={workflows.data.commitSha}
          canTrigger={canTrigger}
          projectBasePath={`/projects/${projectId}`}
          onTrigger={(workflow, trigger) => {
            triggerFocus.capture(trigger)
            setTriggerPath(workflow.path)
          }}
          onRefresh={() => void workflows.refetch()}
          isRefreshing={workflows.isFetching}
        />
      )}

      <RunHistory
        runs={runs.data?.items ?? []}
        total={runs.data?.total ?? 0}
        page={runs.data?.page ?? page}
        pageSize={runs.data?.pageSize ?? RUN_PAGE_SIZE}
        filters={filters}
        workflowOptions={workflowOptions}
        projectBasePath={`/projects/${projectId}`}
        onFiltersChange={applyFilters}
        onClearFilters={clearFilters}
        onPageChange={changePage}
        isPending={runs.isPending}
        errorDescription={runsError?.description ?? null}
        requestId={runsError?.requestId ?? null}
        onRetry={() => void runs.refetch()}
      />

      <TriggerRunDialog
        open={triggerPath !== null}
        onOpenChange={(open) => {
          if (open) return
          setTriggerPath(null)
          triggerFocus.restore()
        }}
        workflows={validWorkflows}
        initialWorkflowPath={triggerPath ?? ''}
        defaultRef={workflows.data?.ref ?? ''}
        onSubmit={(input) => trigger.mutate(input)}
        isSubmitting={trigger.isPending}
        errorMessage={trigger.isError ? describeRequestError(trigger.error).description : null}
      />
    </div>
  )
}

export default Component
