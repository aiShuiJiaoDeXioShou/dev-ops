import { queryOptions } from '@tanstack/react-query'
import type { ApiBody, ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { isPipelineNodeStatus } from '../lib/status'
import type { PipelineNode, PipelineNodeRegistration, PipelineNodeToken } from '../model/types'

/** 节点列表行接口形状。 */
type PipelineNodeResponse = ApiSuccessData<'/api/v1/teams/{teamId}/pipeline-nodes', 'get'>['items'][number]

/** 带请求标识的节点列表视图。 */
export interface PipelineNodeListView {
  items: PipelineNode[]
  requestId: string
}

/** 新建节点入参。 */
export type CreatePipelineNodeInput = ApiBody<'/api/v1/teams/{teamId}/pipeline-nodes', 'post'>

/**
 * 把接口节点映射为视图模型。
 * @param node 接口返回的节点。
 * @returns 视图节点；状态非法时抛出数据异常。
 */
function toPipelineNode(node: PipelineNodeResponse): PipelineNode {
  if (!isPipelineNodeStatus(node.status)) throw new Error(`接口返回了未知的节点状态：${node.status}`)
  return {
    nodeId: node.nodeId,
    name: node.name,
    status: node.status,
    os: node.os,
    arch: node.arch,
    capabilities: node.capabilities,
    concurrencyLimit: node.concurrencyLimit,
    agentVersion: node.agentVersion,
    lastHeartbeatAt: node.lastHeartbeatAt,
    currentRunId: node.currentRunId,
    createdAt: node.createdAt,
  }
}

/**
 * 从节点操作响应中取节点并映射；drain/disable 共用。
 * @param data 接口返回的 { node } 结构。
 * @returns 视图节点。
 */
function toNodeResult(data: { node: PipelineNodeResponse }): PipelineNode {
  return toPipelineNode(data.node)
}

/** 团队执行节点列表查询。 */
export function pipelineNodesQueryOptions(teamId: string) {
  return queryOptions({
    queryKey: ['pipeline', 'nodes', teamId],
    queryFn: async ({ signal }): Promise<PipelineNodeListView> => {
      const result = await apiClient.listPipelineNodes(teamId, { signal })
      return { items: result.data.items.map(toPipelineNode), requestId: result.requestId }
    },
    enabled: Boolean(teamId),
    // 节点状态依赖心跳，列表每 30 秒刷新一次；心跳阈值内的在线状态可及时反映。
    refetchInterval: 30_000,
  })
}

/**
 * 注册执行节点。
 * @param teamId 团队标识。
 * @param input 节点名称与能力标签。
 * @returns 新节点与只显示一次的注册令牌；过期时间从接口字段映射。
 * @throws 请求失败、业务错误或响应契约不合法时抛出 RequestError。
 */
export async function createPipelineNode(
  teamId: string,
  input: CreatePipelineNodeInput,
): Promise<PipelineNodeRegistration> {
  const result = await apiClient.createPipelineNode(teamId, input)
  return {
    node: toPipelineNode(result.data.node),
    registrationToken: result.data.registrationToken,
    expiresAt: result.data.registrationTokenExpiresAt,
  }
}

/**
 * 排空节点：不再分配新运行，已有任务继续。
 * @param nodeId 节点标识。
 * @returns 更新后的节点。
 */
export async function drainPipelineNode(nodeId: string): Promise<PipelineNode> {
  const result = await apiClient.drainPipelineNode(nodeId)
  return toNodeResult(result.data)
}

/**
 * 停用节点并撤销活动 Agent 令牌。
 * @param nodeId 节点标识。
 * @returns 更新后的节点。
 */
export async function disablePipelineNode(nodeId: string): Promise<PipelineNode> {
  const result = await apiClient.disablePipelineNode(nodeId)
  return toNodeResult(result.data)
}

/**
 * 轮换节点 Agent 令牌。
 * @param nodeId 节点标识。
 * @returns 只显示一次的新令牌与签发时间。
 */
export async function rotatePipelineNodeToken(nodeId: string): Promise<PipelineNodeToken> {
  const result = await apiClient.rotatePipelineNodeToken(nodeId)
  return { token: result.data.agentToken, expiresAt: null }
}
