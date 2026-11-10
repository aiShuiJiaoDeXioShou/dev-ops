import { queryOptions } from '@tanstack/react-query'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

/** API Token 元数据类型，来自生成的接口契约。 */
export type ApiTokenMetadata = ApiSuccessData<'/api/v1/me/tokens', 'get'>['items'][number]

/** 当前账号的 API Token 列表。 */
export const apiTokensQueryOptions = queryOptions({
  queryKey: ['identity', 'api-tokens'],
  queryFn: ({ signal }) => apiClient.listApiTokens({ signal }),
  staleTime: 10_000,
})
