import { queryOptions } from '@tanstack/react-query'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

export type BotConnection = ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-connections', 'get'>[number]
export type CatalogModel = ApiSuccessData<'/api/v1/teams/{teamId}/bot-model-catalog', 'get'>[number]

export const connectionQueryKey = ['bot-connections']

/** 读取当前团队的模型连接及服务端允许显示的元数据。 */
export function botConnectionsOptions(teamId: string) {
  return queryOptions({
    queryKey: [...connectionQueryKey, teamId],
    queryFn: ({ signal }) => apiClient.listBotConnections(teamId, { signal }),
  })
}

/** 查询目录中可配置的模型，可按提供方收窄。 */
export function botCatalogOptions(teamId: string, providerId?: string) {
  return queryOptions({
    queryKey: [...connectionQueryKey, teamId, 'models', providerId],
    queryFn: ({ signal }) => apiClient.listBotModelCatalog(teamId, { providerId }, { signal }),
    staleTime: 60_000,
  })
}
