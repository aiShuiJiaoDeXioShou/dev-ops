import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { isPipelineRunStatus } from '../lib/status'
import type {
  PipelineRunStatus,
  PipelineWorkflowDetail,
  PipelineWorkflowInput,
  PipelineWorkflowSummary,
} from '../model/types'

/** 工作流列表查询参数。 */
export type PipelineWorkflowListQuery = ApiQuery<'/api/v1/projects/{projectId}/pipeline-workflows', 'get'>
/** 接口返回的工作流列表形状；字段收窄集中在这一层。 */
type PipelineWorkflowListResponse = ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-workflows', 'get'>
/** 接口返回的工作流详情形状。 */
type PipelineWorkflowDetailResponse = ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-workflows/detail', 'get'>

/** 带请求标识的工作流列表视图。 */
export interface PipelineWorkflowListView {
  ref: string
  commitSha: string
  items: PipelineWorkflowSummary[]
  requestId: string
}

/** 带请求标识的工作流详情视图。 */
export interface PipelineWorkflowDetailView {
  workflow: PipelineWorkflowDetail
  requestId: string
}

const INPUT_TYPES = new Set<PipelineWorkflowInput['type']>(['string', 'boolean', 'number', 'choice'])

function toInputType(value: string): PipelineWorkflowInput['type'] {
  return INPUT_TYPES.has(value as PipelineWorkflowInput['type']) ? (value as PipelineWorkflowInput['type']) : 'string'
}

/**
 * 把接口工作流映射为视图模型；解析错误的可选定位字段统一为 null，兼容旧版测试夹具省略的可选统计字段。
 * @param item 接口返回的工作流项。
 * @returns 视图工作流；最近运行状态非法时抛出数据异常。
 */
function toWorkflowSummary(item: PipelineWorkflowListResponse['items'][number]): PipelineWorkflowSummary {
  let lastRun: PipelineWorkflowSummary['lastRun'] = null
  if (item.lastRun) {
    if (!isPipelineRunStatus(item.lastRun.status)) {
      throw new Error(`接口返回了未知的运行状态：${item.lastRun.status}`)
    }
    lastRun = {
      runId: item.lastRun.runId,
      status: item.lastRun.status,
      createdAt: item.lastRun.createdAt,
      durationSeconds: item.lastRun.durationSeconds ?? null,
      ref: item.lastRun.ref ?? '',
    }
  }
  const recentStatuses: PipelineRunStatus[] = []
  for (const status of item.recentStatuses ?? []) {
    if (isPipelineRunStatus(status)) recentStatuses.push(status)
  }
  if (recentStatuses.length === 0 && lastRun) recentStatuses.push(lastRun.status)

  return {
    path: item.path,
    name: item.name,
    valid: item.valid,
    parseErrors: item.parseErrors.map((error) => ({
      code: error.code,
      message: error.message,
      fieldPath: error.fieldPath ?? null,
      line: error.line ?? null,
      column: error.column ?? null,
    })),
    runsOn: item.runsOn ?? [],
    jobCount: item.jobCount ?? 0,
    stepCount: item.stepCount ?? 0,
    inputCount: item.inputCount ?? 0,
    timeoutMinutes: item.timeoutMinutes ?? null,
    recentStatuses,
    lastRun,
  }
}

/**
 * 把工作流详情接口响应映射为视图模型。
 * @param data 接口返回的工作流详情。
 * @returns 视图模型；不含密钥明文或环境变量明文。
 */
function toWorkflowDetail(data: PipelineWorkflowDetailResponse): PipelineWorkflowDetail {
  return {
    path: data.path,
    name: data.name,
    repositoryId: data.repositoryId,
    ref: data.ref,
    commitSha: data.commitSha,
    content: data.content,
    contentHash: data.contentHash,
    valid: data.valid,
    parseErrors: data.parseErrors.map((error) => ({
      code: error.code,
      message: error.message,
      fieldPath: error.fieldPath ?? null,
      line: error.line ?? null,
      column: error.column ?? null,
    })),
    planJobs: (data.planSummary?.jobs ?? []).map((job) => ({
      id: job.id,
      name: job.name,
      steps: job.steps.map((step) => ({ index: step.index, name: step.name, kind: step.kind })),
    })),
    inputs: data.inputs.map((input) => ({
      name: input.name,
      type: toInputType(input.type),
      required: input.required,
      ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
      ...(input.options ? { options: input.options } : {}),
      ...(input.description ? { description: input.description } : {}),
    })),
  }
}

/** 项目流水线工作流列表查询；不可达仓库由接口返回错误而不是空列表。 */
export function pipelineWorkflowsQueryOptions(projectId: string, ref?: string) {
  return queryOptions({
    queryKey: ['pipeline', 'workflows', projectId, ref ?? ''],
    queryFn: async ({ signal }): Promise<PipelineWorkflowListView> => {
      const result = await apiClient.listPipelineWorkflows(projectId, ref ? { ref } : undefined, { signal })
      return {
        ref: result.data.ref,
        commitSha: result.data.commitSha,
        items: result.data.items.map(toWorkflowSummary),
        requestId: result.requestId,
      }
    },
    enabled: Boolean(projectId),
  })
}

/** 单个工作流的 YAML 源码、执行计划与手动触发参数定义查询。 */
export function pipelineWorkflowDetailQueryOptions(projectId: string, path: string, ref?: string) {
  return queryOptions({
    queryKey: ['pipeline', 'workflow-detail', projectId, path, ref ?? ''],
    queryFn: async ({ signal }): Promise<PipelineWorkflowDetailView> => {
      const result = await apiClient.getPipelineWorkflow(projectId, { path, ...(ref ? { ref } : {}) }, { signal })
      return {
        workflow: toWorkflowDetail(result.data),
        requestId: result.requestId,
      }
    },
    enabled: Boolean(projectId && path),
  })
}
