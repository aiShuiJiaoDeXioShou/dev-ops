import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import { RefreshCw } from 'lucide-react'
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
  shortCommitSha,
  triggerPipelineRun,
  useFocusReturn,
  type PipelineRunListQuery,
  type PipelineWorkflowSummary,
  type TriggerRunInput,
} from '@/features/pipeline/public'
import { Button } from '@/shared/ui/controls/button'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'

/** 运行历史每页条数；与服务端默认值保持接近，便于分页浏览。 */
const RUN_PAGE_SIZE = 20

/** 流水线页内的视图页签；一个页面只展示其中一组内容，避免两个空状态纵向堆叠。 */
type PipelineTab = 'workflows' | 'runs'

const TAB_PARAM = 'tab'

/** 页签顺序与文案；工作流在前，符合“先有工作流再产生运行”的心智模型。 */
const PIPELINE_TABS: { value: PipelineTab; label: string }[] = [
  { value: 'workflows', label: '工作流' },
  { value: 'runs', label: '运行历史' },
]

/**
 * 从 URL 恢复当前页签；未知值回落到工作流页签，保证旧链接行为不变。
 * @param search 当前地址的查询参数。
 * @returns 当前页签标识。
 */
function parseTab(search: URLSearchParams): PipelineTab {
  return search.get(TAB_PARAM) === 'runs' ? 'runs' : 'workflows'
}

/**
 * 把页签写回查询参数；默认页签不写入，保持地址简洁。
 * @param params 已包含筛选与分页的查询参数。
 * @param tab 目标页签。
 * @returns 同一个参数对象，便于链式调用。
 */
function withTab(params: URLSearchParams, tab: PipelineTab): URLSearchParams {
  if (tab === 'workflows') params.delete(TAB_PARAM)
  else params.set(TAB_PARAM, tab)
  return params
}

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
  const tab = parseTab(searchParams)
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

  const changeTab = (next: string) => {
    if (next !== 'workflows' && next !== 'runs') return
    setSearchParams(withTab(new URLSearchParams(searchParams), next))
  }
  const applyFilters = (next: typeof filters) => {
    setSearchParams(withTab(new URLSearchParams(serializeRunFilters(next, 1)), tab))
  }
  const clearFilters = () => {
    setSearchParams(withTab(new URLSearchParams(), tab))
  }
  const changePage = (nextPage: number) => {
    setSearchParams(withTab(new URLSearchParams(serializeRunFilters(filters, nextPage)), tab))
  }

  const workflowOptions =
    workflows.data?.items.map((item) => ({
      path: item.path,
      label: item.name ?? item.path,
    })) ?? []
  const runsError = runs.isError ? describeRequestError(runs.error) : null

  return (
    <div className="project-tab-panel">
      <h1 className="sr-only">流水线</h1>

      <div className="space-y-6">
        <div className="row spread flex-wrap">
          <div className="segments" role="tablist" aria-label="流水线视图">
            {PIPELINE_TABS.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant="ghost"
                size="sm"
                className={`segment ${tab === item.value ? 'active' : ''}`}
                role="tab"
                id={`pipeline-tab-${item.value}`}
                aria-selected={tab === item.value}
                aria-controls={`pipeline-panel-${item.value}`}
                onClick={() => changeTab(item.value)}
              >
                {item.label}{' '}
                <span className="tab-count">
                  {item.value === 'workflows' ? (workflows.data?.items.length ?? 0) : (runs.data?.total ?? 0)}
                </span>
              </Button>
            ))}
          </div>
          {tab === 'workflows' && workflows.data ? (
            <div className="row">
              <span className="small quiet">
                {workflows.data.ref} · {shortCommitSha(workflows.data.commitSha)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void workflows.refetch()}
                disabled={workflows.isFetching}
              >
                <RefreshCw aria-hidden="true" />
                {workflows.isFetching ? '检查中…' : '重新检查'}
              </Button>
            </div>
          ) : null}
        </div>

        <div role="tabpanel" id={`pipeline-panel-${tab}`} aria-labelledby={`pipeline-tab-${tab}`} className="space-y-6">
          {tab === 'workflows' ? (
            workflows.isPending ? (
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
                canTrigger={canTrigger}
                projectBasePath={`/projects/${projectId}`}
                onTrigger={(workflow, trigger) => {
                  triggerFocus.capture(trigger)
                  setTriggerPath(workflow.path)
                }}
                onRefresh={() => void workflows.refetch()}
                isRefreshing={workflows.isFetching}
              />
            )
          ) : (
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
          )}
        </div>
      </div>

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
