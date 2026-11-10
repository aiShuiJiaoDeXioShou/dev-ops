import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { isPipelineRunStatus } from '../lib/status'
import type { PipelineWorkflowSummary } from '../model/types'

/** 工作流列表查询参数。 */
export type PipelineWorkflowListQuery = ApiQuery<'/api/v1/projects/{projectId}/pipeline-workflows', 'get'>
/** 接口返回的工作流列表形状；字段收窄集中在这一层。 */
type PipelineWorkflowListResponse = ApiSuccessData<'/api/v1/projects/{projectId}/pipeline-workflows', 'get'>

/** 带请求标识的工作流列表视图。 */
export interface PipelineWorkflowListView {
  ref: string
  commitSha: string
  items: PipelineWorkflowSummary[]
  requestId: string
}

/**
 * 把接口工作流映射为视图模型；解析错误的可选定位字段统一为 null。
 * @param item 接口返回的工作流项。
 * @returns 视图工作流；最近运行状态非法时抛出数据异常。
 */
function toWorkflowSummary(item: PipelineWorkflowListResponse['items'][number]): PipelineWorkflowSummary {
  let lastRun: PipelineWorkflowSummary['lastRun'] = null
  if (item.lastRun) {
    if (!isPipelineRunStatus(item.lastRun.status)) {
      throw new Error(`接口返回了未知的运行状态：${item.lastRun.status}`)
    }
    lastRun = { runId: item.lastRun.runId, status: item.lastRun.status, createdAt: item.lastRun.createdAt }
  }
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
    lastRun,
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
