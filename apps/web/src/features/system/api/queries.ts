import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'

/** 公共就绪数据不包含用户资源；业务查询需另带身份、团队和资源范围。 */
export const readinessQueryOptions = queryOptions({
  queryKey: ['system', 'readiness'],
  queryFn: ({ signal }) => apiClient.ready(signal),
})
