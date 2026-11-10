import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { isPipelineArtifactStatus, isPipelineRunStatus, isPipelineStepStatus, isRunActive } from '../lib/status'
import type {
  PipelineLogStat,
  PipelineRunArtifact,
  PipelineRunDetail,
  PipelineRunDetailInputValue,
  PipelineRunStep,
  PipelineRunSummary,
  TriggerRunInput,
} from '../model/types'

/** 流水线运行列表查询参数。 */
export type PipelineRunListQuery = ApiQuery<'/api/v1/projects/{projectId}/pipeline-runs', 'get'>
/** 接口返回的运行摘要形状；映射到视图模型前允许字段差异，集中在这一个文件处理。 */
type PipelineRunSummaryResponse = ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-runs', 'get'>['items'][number]
/** 接口返回的运行详情形状。 */
type PipelineRunDetailResponse = ApiSuccessData<'/api/v1/pipeline-runs/{runId}', 'get'>

/** 带请求标识的运行列表视图。 */
export interface PipelineRunListPageView {
  items: PipelineRunSummary[]
  page: number
  pageSize: number
  total: number
  requestId: string
}

/** 带请求标识的运行详情视图。 */
export interface PipelineRunDetailView {
  run: PipelineRunDetail
  requestId: string
}

/**
 * 把接口步骤映射为视图模型。
 * @param step 接口返回的步骤。
 * @returns 视图步骤；状态非法时抛出数据异常。
 */
function toRunStep(step: PipelineRunDetailResponse['steps'][number]): PipelineRunStep {
  if (!isPipelineStepStatus(step.status)) throw new Error(`接口返回了未知的步骤状态：${step.status}`)
  return {
    index: step.index,
    name: step.name,
    kind: step.kind,
    status: step.status,
    exitCode: step.exitCode,
    errorCode: step.errorCode,
    errorMessage: step.errorMessage,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
  }
}

/**
 * 把接口产物映射为视图模型；下载地址由接口按权限签发。
 * @param artifact 接口返回的产物。
 * @returns 视图产物；状态非法时抛出数据异常。
 */
function toRunArtifact(artifact: PipelineRunDetailResponse['artifacts'][number]): PipelineRunArtifact {
  if (!isPipelineArtifactStatus(artifact.status)) throw new Error(`接口返回了未知的产物状态：${artifact.status}`)
  return {
    artifactId: artifact.artifactId,
    name: artifact.name,
    stepIndex: artifact.stepIndex,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    status: artifact.status,
    createdAt: artifact.createdAt,
    downloadUrl: artifact.downloadUrl,
  }
}

/**
 * 把接口日志统计映射为视图模型。
 * @param stat 接口返回的步骤日志统计。
 * @returns 视图日志统计。
 */
function toLogStat(stat: PipelineRunDetailResponse['logs']['items'][number]): PipelineLogStat {
  return {
    stepIndex: stat.stepIndex,
    chunkCount: stat.chunkCount,
    sizeBytes: stat.sizeBytes,
    lastSeq: stat.lastSeq,
  }
}

/**
 * 把接口运行摘要映射为视图模型。
 * @param run 接口返回的运行。
 * @returns 视图运行摘要；状态非法时抛出数据异常。
 */
function toRunSummary(run: PipelineRunSummaryResponse): PipelineRunSummary {
  if (!isPipelineRunStatus(run.status)) throw new Error(`接口返回了未知的运行状态：${run.status}`)
  return {
    runId: run.runId,
    workflowPath: run.workflowPath,
    workflowName: run.workflowName,
    ref: run.ref,
    commitSha: run.commitSha,
    status: run.status,
    initiator: run.initiator,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationSeconds: run.durationSeconds,
  }
}

/**
 * 把接口运行详情映射为视图模型。
 * @param data 接口返回的运行详情。
 * @returns 视图运行详情；状态非法时抛出数据异常。
 */
function toRunDetail(data: PipelineRunDetailResponse): PipelineRunDetail {
  const summary = toRunSummary(data)
  const inputs: Record<string, PipelineRunDetailInputValue> = {}
  for (const [key, value] of Object.entries(data.inputs)) {
    inputs[key] = value
  }
  return {
    ...summary,
    triggerSource: data.triggerSource,
    initiatorChannel: data.initiatorChannel,
    nodeId: data.nodeId,
    nodeName: data.nodeName,
    errorCode: data.errorCode,
    errorMessage: data.errorMessage,
    cancelRequestedAt: data.cancelRequestedAt,
    inputs,
    steps: data.steps.map(toRunStep),
    artifacts: data.artifacts.map(toRunArtifact),
    logs: data.logs.items.map(toLogStat),
  }
}

/** 项目流水线运行列表查询；返回已映射的视图模型与请求标识。 */
export function pipelineRunsQueryOptions(projectId: string, query: PipelineRunListQuery = {}) {
  return queryOptions({
    queryKey: ['pipeline', 'runs', projectId, query],
    queryFn: async ({ signal }): Promise<PipelineRunListPageView> => {
      const result = await apiClient.listPipelineRuns(projectId, query, { signal })
      return {
        items: result.data.items.map(toRunSummary),
        page: result.data.page,
        pageSize: result.data.pageSize,
        total: result.data.total,
        requestId: result.requestId,
      }
    },
    enabled: Boolean(projectId),
  })
}

/** 流水线运行详情查询；返回已映射的视图模型与请求标识。 */
export function pipelineRunQueryOptions(runId: string) {
  return queryOptions({
    queryKey: ['pipeline', 'run', runId],
    queryFn: async ({ signal }): Promise<PipelineRunDetailView> => {
      const result = await apiClient.getPipelineRun(runId, { signal })
      return { run: toRunDetail(result.data), requestId: result.requestId }
    },
    enabled: Boolean(runId),
    // 运行未结束时轮询详情，步骤状态与终态可自动更新；终态停止轮询。
    refetchInterval: (query) => (query.state.data && isRunActive(query.state.data.run.status) ? 3000 : false),
  })
}

/**
 * 触发一次运行。
 * @param projectId 项目标识。
 * @param input 工作流路径、ref、输入与幂等键。
 * @returns 新创建或幂等命中的运行详情。
 * @throws 权限、工作流、仓库、输入或幂等冲突等业务错误抛出 RequestError。
 */
export async function triggerPipelineRun(projectId: string, input: TriggerRunInput): Promise<PipelineRunDetailView> {
  const result = await apiClient.triggerPipelineRun(projectId, input)
  return { run: toRunDetail(result.data), requestId: result.requestId }
}

/**
 * 请求取消运行。
 * @param runId 运行标识。
 * @param reason 可选取消原因，写入审计。
 * @returns 最新运行详情。
 * @throws 终态、权限或状态冲突等业务错误抛出 RequestError。
 */
export async function cancelPipelineRun(runId: string, reason: string): Promise<PipelineRunDetailView> {
  const body = reason ? { reason } : {}
  const result = await apiClient.cancelPipelineRun(runId, body)
  return { run: toRunDetail(result.data), requestId: result.requestId }
}
