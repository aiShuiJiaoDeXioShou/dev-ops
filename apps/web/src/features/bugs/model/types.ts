import type { ApiSuccessData } from '@dev-ops/api-client'
export type BugDetail = ApiSuccessData<'/api/v1/bugs/{bugId}', 'get'>
export type BugListItem = ApiSuccessData<'/api/v1/projects/{projectId}/bugs', 'get'>['items'][number]
