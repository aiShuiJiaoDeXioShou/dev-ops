import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { useOutletContext, useParams, useSearchParams } from 'react-router'
import { GitBranch, GitCommitHorizontal, Play, RefreshCw, Server, Workflow } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { CancelRunDialog } from '@/features/pipeline/ui/cancel-run-dialog'
import { PipelineNodesDialog } from '@/features/pipeline/ui/pipeline-nodes-dialog'
import { RunHistory } from '@/features/pipeline/ui/run-history'
import { TriggerRunDialog } from '@/features/pipeline/ui/trigger-run-dialog'
import {
  InvalidWorkflowsBanner,
  PipelineOverviewMetrics,
  WorkflowRail,
  WorkflowSummaryCard,
} from '@/features/pipeline/ui/workflow-catalog'
import { WorkflowDefinitionDialog } from '@/features/pipeline/ui/workflow-definition-dialog'
import { parseRunFilters, parseRunPage, serializeRunFilters, shortCommitSha } from '@/features/pipeline/lib/format'
import { isRunActive } from '@/features/pipeline/lib/status'
import { pipelineNodesQueryOptions } from '@/features/pipeline/api/nodes'
import {
  cancelPipelineRun,
  pipelineRunsQueryOptions,
  triggerPipelineRun,
  type PipelineRunListQuery,
} from '@/features/pipeline/api/runs'
import { pipelineWorkflowsQueryOptions } from '@/features/pipeline/api/workflows'
import { useFocusReturn } from '@/features/pipeline/hooks/use-focus-return'
import type { PipelineRunSummary, PipelineWorkflowSummary, TriggerRunInput } from '@/features/pipeline/model/types'
import { Button } from '@/shared/ui/controls/button'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { PipelinesPageSkeleton } from '@/pages/page-skeletons'
import { useSession } from '@/features/identity/model/session'
import { useGitHubAccountFeedback } from '@/features/identity/model/use-github-account-feedback'
import { GitHubAccountButton } from '@/features/identity/ui/github-account'
import { useProjectRole } from '@/features/projects/model/use-project-role'
import { useToast } from '@/shared/ui/toast'
import '@/features/pipeline/ui/pipeline.css'

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
 * 项目流水线工作台页。
 *
 * 采用左侧工作流目录 + 右侧摘要与运行流的主从双栏布局：
 * 在单屏内同时呈现工作流配置指标、静态执行链路、解析错误定位以及内嵌阶段进度条的运行历史，
 * 支持查看 YAML 与执行计划、按工作流声明动态触发、快捷重跑与取消运行。
 */
export function Component() {
  useGitHubAccountFeedback()
  const { projectId = '' } = useParams()
  const outletTeamId = useOutletContext<string | undefined>()
  const { currentTeam } = useSession()
  const teamId = outletTeamId || currentTeam?.id || ''
  const [searchParams, setSearchParams] = useSearchParams()
  const role = useProjectRole()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [triggerState, setTriggerState] = useState<{ workflowPath: string; ref: string } | null>(null)
  const [inspectWorkflow, setInspectWorkflow] = useState<PipelineWorkflowSummary | null>(null)
  const [nodesDialogOpen, setNodesDialogOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<PipelineRunSummary | null>(null)
  const triggerFocus = useFocusReturn()
  const cancelFocus = useFocusReturn()

  const filters = useMemo(() => parseRunFilters(searchParams), [searchParams])
  const page = parseRunPage(searchParams)
  const runQuery = toRunListQuery(filters, page)

  const workflows = useQuery(pipelineWorkflowsQueryOptions(projectId))
  const runs = useQuery(pipelineRunsQueryOptions(projectId, runQuery))
  const nodes = useQuery(pipelineNodesQueryOptions(teamId))

  const canTrigger = role === 'admin' || role === 'developer'
  const workflowItems = workflows.data?.items ?? []
  const validWorkflows = workflowItems.filter((item) => item.valid)
  const invalidWorkflows = workflowItems.filter((item) => !item.valid)
  const activeWorkflow = workflowItems.find((item) => item.path === filters.workflowPath) ?? null
  const nodeItems = nodes.data?.items ?? []
  const onlineNodeCount = nodeItems.filter((node) => node.status === 'online').length

  const trigger = useMutation({
    mutationFn: (input: TriggerRunInput) => triggerPipelineRun(projectId, input),
    onSuccess: async (result) => {
      setTriggerState(null)
      triggerFocus.restore()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pipeline', 'runs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline', 'workflows', projectId] }),
      ])
      showToast(`运行已创建：${result.run.runId.slice(0, 8)}`, 'success')
    },
    onError: (error: unknown) => {
      if (
        !isBusinessError(error, 'GITHUB_ACCOUNT_REQUIRED') &&
        !isBusinessError(error, 'GITHUB_REPOSITORY_FORBIDDEN')
      ) {
        showToast(describeRequestError(error).description, 'error')
      }
    },
  })

  const cancelMutation = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) => cancelPipelineRun(runId, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pipeline', 'runs', projectId] })
      showToast('已提交取消请求，正在等待执行节点确认。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const requiresGitHubAccount = isBusinessError(trigger.error, 'GITHUB_ACCOUNT_REQUIRED')
  const lacksGitHubReadAccess = isBusinessError(trigger.error, 'GITHUB_REPOSITORY_FORBIDDEN')
  const triggerError = lacksGitHubReadAccess
    ? '请向仓库管理员申请读取权限，授权后重新触发流水线。'
    : trigger.isError
      ? describeRequestError(trigger.error).description
      : null

  const applyFilters = (next: typeof filters) => {
    setSearchParams(new URLSearchParams(serializeRunFilters(next, 1)))
  }
  const selectWorkflow = (workflowPath: string) => {
    applyFilters({ ...filters, workflowPath })
  }
  const clearFilters = () => {
    setSearchParams(
      new URLSearchParams(serializeRunFilters({ workflowPath: filters.workflowPath, status: '', from: '', to: '' }, 1)),
    )
  }
  const changePage = (nextPage: number) => {
    setSearchParams(new URLSearchParams(serializeRunFilters(filters, nextPage)))
  }

  const openTriggerDialog = (workflowPath: string, ref: string, element: HTMLElement | null) => {
    triggerFocus.capture(element)
    trigger.reset()
    setTriggerState({ workflowPath, ref })
  }

  const runsError = runs.isError ? describeRequestError(runs.error) : null
  const activeRunCount = (runs.data?.items ?? []).filter((item) => isRunActive(item.status)).length

  if (workflows.isPending) {
    return <PipelinesPageSkeleton />
  }

  if (workflows.isError) {
    const described = describeRequestError(workflows.error)
    return (
      <div className="project-tab-panel">
        <h1 className="sr-only">流水线</h1>
        <PageError
          title="工作流读取失败"
          description={described.description}
          requestId={described.requestId}
          retrying={workflows.isFetching}
          onRetry={() => void workflows.refetch()}
        />
      </div>
    )
  }

  const defaultRef = workflows.data.ref
  const defaultTriggerPath = (activeWorkflow?.valid ? activeWorkflow.path : validWorkflows[0]?.path) ?? ''

  return (
    <div className="project-tab-panel">
      <h1 className="sr-only">流水线</h1>

      <div className="pl-root">
        <div className="pl-context-bar">
          <div className="pl-context-left">
            <span className="pl-ref-pill">
              <GitBranch size={13} aria-hidden="true" />
              <span className="mono">{defaultRef}</span>
            </span>
            <span className="pl-context-commit" title={workflows.data.commitSha}>
              <GitCommitHorizontal size={14} aria-hidden="true" />
              <span className="mono">{shortCommitSha(workflows.data.commitSha)}</span>
              <span className="pl-context-dir mono">.devops/workflows/</span>
            </span>
          </div>

          <div className="pl-context-right">
            {teamId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="pl-node-summary"
                onClick={() => setNodesDialogOpen(true)}
                aria-label="查看自托管执行节点状态"
              >
                <span className={`pl-node-dot ${onlineNodeCount > 0 ? 'online' : 'offline'}`} aria-hidden="true" />
                <Server size={13} aria-hidden="true" />
                <span>
                  {nodes.isPending ? '执行节点检查中…' : `${onlineNodeCount}/${nodeItems.length} 执行节点在线`}
                </span>
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void workflows.refetch()
                void runs.refetch()
              }}
              disabled={workflows.isFetching}
            >
              <RefreshCw size={14} className={workflows.isFetching ? 'pl-spin' : undefined} aria-hidden="true" />
              {workflows.isFetching ? '检查中…' : '重新检查'}
            </Button>

            {canTrigger ? (
              <Button
                type="button"
                size="sm"
                disabled={validWorkflows.length === 0}
                onClick={(event) => openTriggerDialog(defaultTriggerPath, defaultRef, event.currentTarget)}
              >
                <Play size={14} aria-hidden="true" />
                触发运行
              </Button>
            ) : null}
          </div>
        </div>

        {!canTrigger ? (
          <div className="pl-readonly-note">
            当前角色为只读浏览者，可查看工作流定义、执行过程与日志，不能触发运行或取消任务。
          </div>
        ) : null}

        {workflowItems.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="还没有流水线工作流"
            description="在已关联仓库的 .devops/workflows/ 目录下新增 .yml 或 .yaml 工作流文件并推送后，点击“重新检查”即可发现。"
            action={
              <Button type="button" variant="outline" onClick={() => void workflows.refetch()}>
                <RefreshCw size={14} aria-hidden="true" />
                重新检查
              </Button>
            }
          />
        ) : (
          <div className="pl-workspace">
            <WorkflowRail
              workflows={workflowItems}
              selectedPath={filters.workflowPath}
              totalRuns={runs.data?.total ?? 0}
              activeRunCount={activeRunCount}
              onSelect={selectWorkflow}
            />

            <div className="pl-main-col">
              {activeWorkflow ? (
                <WorkflowSummaryCard
                  projectId={projectId}
                  workflow={activeWorkflow}
                  refName={defaultRef}
                  canTrigger={canTrigger}
                  onInspect={(wf) => setInspectWorkflow(wf)}
                  onTrigger={(wf, el) => openTriggerDialog(wf.path, defaultRef, el)}
                />
              ) : (
                <>
                  <PipelineOverviewMetrics workflows={workflowItems} runs={runs.data?.items ?? []} />
                  <InvalidWorkflowsBanner
                    invalidWorkflows={invalidWorkflows}
                    onSelectWorkflow={(path) => selectWorkflow(path)}
                  />
                </>
              )}

              <RunHistory
                runs={runs.data?.items ?? []}
                total={runs.data?.total ?? 0}
                page={runs.data?.page ?? page}
                pageSize={runs.data?.pageSize ?? RUN_PAGE_SIZE}
                filters={filters}
                projectBasePath={`/projects/${projectId}`}
                canOperate={canTrigger}
                hasValidWorkflows={validWorkflows.length > 0}
                onFiltersChange={applyFilters}
                onClearFilters={clearFilters}
                onPageChange={changePage}
                onRerun={(run, el) => {
                  const target = validWorkflows.find((wf) => wf.path === run.workflowPath)
                  if (!target) {
                    showToast('该工作流当前不可触发，请先修复工作流解析错误。', 'error')
                    return
                  }
                  openTriggerDialog(target.path, run.ref, el)
                }}
                onCancelRun={(run, el) => {
                  cancelFocus.capture(el)
                  setCancelTarget(run)
                }}
                onTriggerFirst={(el) => openTriggerDialog(defaultTriggerPath, defaultRef, el)}
                isPending={runs.isPending}
                errorDescription={runsError?.description ?? null}
                requestId={runsError?.requestId ?? null}
                onRetry={() => void runs.refetch()}
              />
            </div>
          </div>
        )}
      </div>

      <WorkflowDefinitionDialog
        projectId={projectId}
        workflow={inspectWorkflow}
        refName={defaultRef}
        open={inspectWorkflow !== null}
        onOpenChange={(open) => {
          if (!open) setInspectWorkflow(null)
        }}
        canTrigger={canTrigger}
        onTrigger={(wf) => openTriggerDialog(wf.path, defaultRef, null)}
      />

      <PipelineNodesDialog open={nodesDialogOpen} onOpenChange={setNodesDialogOpen} nodes={nodeItems} />

      <TriggerRunDialog
        projectId={projectId}
        open={triggerState !== null}
        onOpenChange={(open) => {
          if (open) return
          setTriggerState(null)
          triggerFocus.restore()
        }}
        workflows={validWorkflows}
        initialWorkflowPath={triggerState?.workflowPath ?? ''}
        defaultRef={triggerState?.ref ?? defaultRef}
        onSubmit={(input) => trigger.mutate(input)}
        isSubmitting={trigger.isPending}
        errorMessage={triggerError}
        errorAction={requiresGitHubAccount ? <GitHubAccountButton label="绑定 GitHub 账号" /> : undefined}
      />

      <CancelRunDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setCancelTarget(null)
          cancelFocus.restore()
        }}
        runLabel={
          cancelTarget
            ? `${cancelTarget.workflowName ?? cancelTarget.workflowPath}（${cancelTarget.runId.slice(0, 8)}）`
            : ''
        }
        isPending={cancelMutation.isPending}
        onConfirm={(reason) => {
          if (!cancelTarget) return
          const targetId = cancelTarget.runId
          setCancelTarget(null)
          cancelFocus.restore()
          cancelMutation.mutate({ runId: targetId, reason })
        }}
      />
    </div>
  )
}

export default Component
