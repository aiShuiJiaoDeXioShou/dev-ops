import type { ApiSuccessData } from '@dev-ops/api-client'

/** 需求详情接口数据。 */
export type RequirementDetail = ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>
/** 需求列表项接口数据。 */
export type RequirementListItem = ApiSuccessData<'/api/v1/projects/{projectId}/requirements', 'get'>['items'][number]
