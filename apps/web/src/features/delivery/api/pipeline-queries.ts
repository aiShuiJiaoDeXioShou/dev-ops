import { queryOptions } from '@tanstack/react-query'
import type { ApiQuery } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

export type PipelineRunQuery = ApiQuery<'/api/v1/projects/{projectId}/pipeline-runs', 'get'>

export function pipelineRunsQueryOptions(projectId: string, query: PipelineRunQuery) {
  return queryOptions({
    queryKey: ['delivery', 'pipeline-runs', projectId, query],
    queryFn: ({ signal }) => apiClient.listPipelineRuns(projectId, query, { signal }),
    enabled: Boolean(projectId),
  })
}
