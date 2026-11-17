import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { botCatalogOptions, botConnectionsOptions } from '../api/connections'

/**
 * 根据团队的可用连接和认证方式提供模型选项，切换连接时清空模型。
 * @param teamId 当前团队。
 * @param enabled 是否允许查询模型配置。
 * @param initialConnectionId 已绑定的连接，可留空。
 * @param initialModelId 已绑定的模型，可留空。
 * @returns 选择状态和已通过候选校验的绑定。
 */
export function useBotModelSelection(teamId: string, enabled: boolean, initialConnectionId = '', initialModelId = '') {
  const [connectionId, setConnectionId] = useState(initialConnectionId)
  const [modelId, setModelId] = useState(initialModelId)
  const connections = useQuery({ ...botConnectionsOptions(teamId), enabled })
  const available = connections.data?.data.filter((connection) => connection.status === 'active') ?? []
  const selected = available.find((connection) => connection.id === connectionId)
  const catalog = useQuery({ ...botCatalogOptions(teamId, selected?.providerId), enabled: enabled && !!selected })
  const models =
    catalog.data?.data.filter(
      (model) => selected && model.providerId === selected.providerId && model.authTypes.includes(selected.authType),
    ) ?? []
  const binding =
    enabled && connections.isSuccess && catalog.isSuccess && models.some((model) => model.modelId === modelId)
      ? { connectionId, modelId }
      : undefined
  return {
    connections,
    available,
    connectionId,
    selected,
    selectConnection: (id: string) => {
      setConnectionId(id)
      setModelId('')
    },
    catalog,
    models,
    modelId,
    setModelId,
    binding,
  }
}
