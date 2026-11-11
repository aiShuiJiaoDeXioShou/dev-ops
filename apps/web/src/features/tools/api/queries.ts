import { queryOptions } from '@tanstack/react-query'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** 工具能力状态视图。 */
export type ToolCapabilitiesView = ApiSuccessData<'/api/v1/projects/{projectId}/tools/capabilities', 'get'>
/** 代码变更列表视图。 */
export type CodeChangeListView = ApiSuccessData<'/api/v1/projects/{projectId}/tools/code-changes', 'get'>
/** 代码变更详情视图。 */
export type CodeChangeView = ApiSuccessData<'/api/v1/tools/code-changes/{codeChangeId}', 'get'>

/** 项目写能力查询。 */
export function toolCapabilitiesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['tools', 'capabilities', projectId],
    queryFn: ({ signal }) => apiClient.getToolCapabilities(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 项目代码变更列表查询。 */
export function codeChangesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['tools', 'code-changes', projectId],
    queryFn: ({ signal }) => apiClient.listCodeChanges(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}

/** 项目写能力调用记录查询。 */
export function toolInvocationsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['tools', 'invocations', projectId],
    queryFn: ({ signal }) => apiClient.listToolInvocations(projectId, { signal }),
    enabled: Boolean(projectId),
  })
}
