import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { appendPipelineActivity } from './pipeline.activity.ts'
import {
  consumeRegistrationToken,
  findActiveLeasesWithRunStatusByNode,
  findActivePipelineNodeTokenByHash,
  findActiveLeaseRunIdsByNodeIds,
  findPipelineNodeById,
  findPipelineNodes,
  findPipelineNodeByTeamName,
  insertPipelineNode,
  insertPipelineNodeToken,
  revokePipelineNodeTokens,
  touchPipelineNode,
  updatePipelineNodeStatus,
  type PipelineNodeRow,
} from './pipeline.nodes.repository.ts'
import { isUniqueViolation } from './pipeline.repository.ts'
import type { PipelineNodeView } from './pipeline.view.ts'

/** P1 允许的能力标签白名单；未知标签不能进入调度匹配，避免 Agent 自报任意能力。 */
export const PIPELINE_NODE_CAPABILITY_WHITELIST: readonly string[] = ['linux', 'docker', 'node24']

/** Agent 协议版本；注册响应返回，供 Agent 校验兼容性。 */
export const AGENT_PROTOCOL_VERSION = 2

/** 心跳建议间隔（秒）；与 agent-protocol.md §3 一致。 */
export const AGENT_HEARTBEAT_INTERVAL_SECONDS = 15

/** 注册令牌有效期（分钟）；一次性令牌短期有效，过期后必须重新生成。 */
const REGISTRATION_TOKEN_TTL_MS = 30 * 60 * 1000

/** P1 接受的 Agent 主版本；不兼容主版本拒绝注册。 */
const SUPPORTED_AGENT_MAJOR_VERSIONS: ReadonlySet<number> = new Set([0, 1])

/** 节点服务配置；由 bootstrap 注入。 */
export interface PipelineNodesServiceConfig {
  leaseTtlSeconds: number
}

/** 节点服务依赖。 */
export interface PipelineNodesServiceDeps {
  db: Database
  config: PipelineNodesServiceConfig
}

/** 创建节点输入。 */
export interface CreatePipelineNodeInput {
  name: string
  capabilities: string[]
}

/** Agent 注册输入；name 只作为 Agent 自述信息记录口径，节点以注册令牌绑定关系为准。 */
export interface AgentRegisterInput {
  registrationToken: string
  name: string
  os: string
  arch: string
  capabilities: string[]
  agentVersion: string
}

/** Agent 心跳输入。 */
export interface AgentHeartbeatInput {
  version: string
  runningLeaseId?: string | null
  capabilities?: string[] | null
}

/** 已认证 Agent 节点。 */
export interface AuthenticatedAgentNode {
  node: PipelineNodeRow
}

/** 计算令牌 SHA-256 哈希；数据库只保存哈希，明文只在创建/注册响应出现一次。 */
export function hashPipelineToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 生成带业务前缀的随机令牌。 */
function createPlainToken(prefix: 'preg' | 'pagent' | 'pl'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

/** 校验能力标签全部在白名单内、去重后非空；返回稳定顺序。 */
export function validateNodeCapabilities(capabilities: string[]): string[] {
  const unique = [...new Set(capabilities.map((capability) => capability.trim()).filter(Boolean))]
  if (unique.length === 0 || unique.length > 30) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '能力标签数量必须在 1-30 个之间')
  }
  for (const capability of unique) {
    if (!PIPELINE_NODE_CAPABILITY_WHITELIST.includes(capability)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `不支持的能力标签：${capability}`)
    }
  }
  return unique
}

/** 校验 Agent 版本为语义化版本且主版本受支持。 */
function validateAgentVersion(version: string): string {
  const trimmed = version.trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed)) {
    throw new ApiError(ERROR_CODES.AGENT_VERSION_UNSUPPORTED, 'Agent 版本格式不合法')
  }
  const major = Number(trimmed.split('.')[0])
  if (!SUPPORTED_AGENT_MAJOR_VERSIONS.has(major)) {
    throw new ApiError(ERROR_CODES.AGENT_VERSION_UNSUPPORTED, 'Agent 版本不兼容当前平台协议')
  }
  return trimmed
}

function normalizeNodeName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 120) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '节点名称长度必须在 1-120 个字符之间')
  }
  return trimmed
}

function validateOsArch(os: string, arch: string): { os: string; arch: string } {
  const normalizedOs = os.trim().toLowerCase()
  const normalizedArch = arch.trim().toLowerCase()
  if (!/^[a-z0-9._-]{1,40}$/.test(normalizedOs) || !/^[a-z0-9._-]{1,40}$/.test(normalizedArch)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '操作系统或架构标识不合法')
  }
  return { os: normalizedOs, arch: normalizedArch }
}

/** 从 Authorization 头解析 Bearer 令牌。 */
function bearerToken(headers: IncomingHttpHeaders): string | null {
  const value = headers.authorization
  if (typeof value !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]?.trim() || null
}

/**
 * 创建流水线节点服务：管理员节点管理与 Agent 注册/心跳/令牌认证。
 * @param deps 数据库与租约配置。
 * @returns 节点列表、创建、排空、停用、令牌轮换以及 Agent 认证/注册/心跳用例。
 * @remarks 令牌明文只在创建与注册响应返回一次，数据库只保存 SHA-256 哈希；
 * 节点注册以注册令牌绑定的节点为准，Agent 请求中的 name 不参与校验（Lead 决策）。
 */
export function createPipelineNodesService(deps: PipelineNodesServiceDeps) {
  const { db, config } = deps

  function toNodeView(row: PipelineNodeRow, currentRunId: string | null): PipelineNodeView {
    return {
      nodeId: row.id,
      teamId: row.team_id,
      name: row.name,
      status: row.status,
      os: row.os,
      arch: row.arch,
      capabilities: row.capabilities,
      concurrencyLimit: row.concurrency_limit,
      agentVersion: row.agent_version,
      lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
      lastErrorCode: row.last_error_code,
      currentRunId,
      disabledAt: row.disabled_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    }
  }

  async function requireNodeAdmin(actor: SessionUser, nodeId: string): Promise<PipelineNodeRow> {
    const node = await findPipelineNodeById(db, nodeId)
    if (!node) throw new ApiError(ERROR_CODES.PIPELINE_NODE_NOT_FOUND, '执行节点不存在')
    await requireTeamMember(db, actor.id, node.team_id, ['admin'])
    return node
  }

  async function listNodes(actor: SessionUser, teamId: string): Promise<PipelineNodeView[]> {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const rows = await findPipelineNodes(db, teamId)
    const runs = await findActiveLeaseRunIdsByNodeIds(
      db,
      rows.map((row) => row.id),
    )
    const currentRuns = new Map(runs.map((run) => [run.nodeId, run.runId]))
    return rows.map((row) => toNodeView(row, currentRuns.get(row.id) ?? null))
  }

  async function createNode(
    actor: SessionUser,
    teamId: string,
    input: CreatePipelineNodeInput,
  ): Promise<{ node: PipelineNodeView; registrationToken: string; registrationTokenExpiresAt: string }> {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const name = normalizeNodeName(input.name)
    const capabilities = validateNodeCapabilities(input.capabilities)
    if (await findPipelineNodeByTeamName(db, teamId, name)) {
      throw new ApiError(ERROR_CODES.PIPELINE_NODE_NAME_CONFLICT, '团队内已存在同名节点')
    }
    const nodeId = randomUUID()
    const registrationToken = createPlainToken('preg')
    const expiresAt = new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS)
    try {
      await db.transaction(async (tx) => {
        await insertPipelineNode(tx, {
          id: nodeId,
          teamId,
          name,
          status: 'pending',
          os: 'unknown',
          arch: 'unknown',
          capabilities,
          concurrencyLimit: 1,
          createdByUserId: actor.id,
        })
        await insertPipelineNodeToken(tx, {
          id: randomUUID(),
          teamId,
          nodeId,
          tokenKind: 'registration',
          tokenHash: hashPipelineToken(registrationToken),
          status: 'active',
          expiresAt,
        })
        await appendPipelineActivity(tx, {
          teamId,
          entityType: 'pipeline_node',
          entityId: nodeId,
          action: 'pipeline_node_registered',
          actorUserId: actor.id,
          changes: { name, capabilities },
        })
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.PIPELINE_NODE_NAME_CONFLICT, '团队内已存在同名节点')
      }
      throw error
    }
    const node = await findPipelineNodeById(db, nodeId)
    if (!node) throw new Error('节点创建后读取失败')
    return {
      node: toNodeView(node, null),
      registrationToken,
      registrationTokenExpiresAt: expiresAt.toISOString(),
    }
  }

  async function drainNode(actor: SessionUser, nodeId: string): Promise<PipelineNodeView> {
    const existing = await requireNodeAdmin(actor, nodeId)
    if (existing.status === 'draining') {
      return toNodeView(existing, null)
    }
    const updated = await updatePipelineNodeStatus(db, nodeId, ['pending', 'online', 'offline'], { status: 'draining' })
    if (!updated) throw new ApiError(ERROR_CODES.PIPELINE_STATE_CONFLICT, '当前节点状态不允许排空')
    await appendPipelineActivity(db, {
      teamId: updated.team_id,
      entityType: 'pipeline_node',
      entityId: nodeId,
      action: 'pipeline_node_drained',
      actorUserId: actor.id,
      changes: { previousStatus: existing.status, status: updated.status },
    })
    return toNodeView(updated, null)
  }

  async function disableNode(actor: SessionUser, nodeId: string): Promise<PipelineNodeView> {
    const existing = await requireNodeAdmin(actor, nodeId)
    const disabledAt = new Date()
    const updated = await updatePipelineNodeStatus(db, nodeId, ['pending', 'online', 'draining', 'offline'], {
      status: 'disabled',
      disabledAt,
      disabledByUserId: actor.id,
    })
    if (!updated) throw new ApiError(ERROR_CODES.PIPELINE_STATE_CONFLICT, '节点已停用或状态不允许停用')
    await revokePipelineNodeTokens(db, nodeId, disabledAt)
    await appendPipelineActivity(db, {
      teamId: updated.team_id,
      entityType: 'pipeline_node',
      entityId: nodeId,
      action: 'pipeline_node_disabled',
      actorUserId: actor.id,
      changes: { previousStatus: existing.status },
    })
    return toNodeView(updated, null)
  }

  async function rotateToken(
    actor: SessionUser,
    nodeId: string,
  ): Promise<{ nodeId: string; agentToken: string; createdAt: string }> {
    const existing = await requireNodeAdmin(actor, nodeId)
    if (existing.status === 'disabled') {
      throw new ApiError(ERROR_CODES.PIPELINE_STATE_CONFLICT, '节点已停用，不能轮换令牌')
    }
    const agentToken = createPlainToken('pagent')
    const now = new Date()
    await db.transaction(async (tx) => {
      await revokePipelineNodeTokens(tx, nodeId, now)
      await insertPipelineNodeToken(tx, {
        id: randomUUID(),
        teamId: existing.team_id,
        nodeId,
        tokenKind: 'agent',
        tokenHash: hashPipelineToken(agentToken),
        status: 'active',
        expiresAt: null,
      })
      await appendPipelineActivity(tx, {
        teamId: existing.team_id,
        entityType: 'pipeline_node',
        entityId: nodeId,
        action: 'pipeline_node_token_rotated',
        actorUserId: actor.id,
        changes: { name: existing.name },
      })
    })
    return { nodeId, agentToken, createdAt: now.toISOString() }
  }

  async function registerAgent(input: AgentRegisterInput): Promise<{
    nodeId: string
    agentToken: string
    protocolVersion: number
    heartbeatIntervalSeconds: number
    leaseTtlSeconds: number
  }> {
    const tokenHash = hashPipelineToken(input.registrationToken)
    const token = await findActivePipelineNodeTokenByHash(db, tokenHash)
    if (!token || token.token_kind !== 'registration') {
      throw new ApiError(ERROR_CODES.AGENT_REGISTRATION_TOKEN_INVALID, '注册令牌无效或已使用')
    }
    if (token.expires_at !== null && token.expires_at.getTime() <= Date.now()) {
      throw new ApiError(ERROR_CODES.AGENT_REGISTRATION_TOKEN_INVALID, '注册令牌已过期')
    }
    const node = await findPipelineNodeById(db, token.node_id)
    if (!node || node.team_id !== token.team_id) {
      throw new ApiError(ERROR_CODES.AGENT_REGISTRATION_TOKEN_INVALID, '注册令牌绑定的节点不存在')
    }
    if (node.status === 'disabled') {
      throw new ApiError(ERROR_CODES.AGENT_NODE_DISABLED, '节点已停用，不能注册')
    }
    const capabilities = validateNodeCapabilities(input.capabilities)
    // 能力标签来自管理员创建节点时的授权范围，Agent 不能通过注册扩大能力。
    if (capabilities.some((capability) => !node.capabilities.includes(capability))) {
      throw new ApiError(ERROR_CODES.AGENT_REGISTRATION_TOKEN_INVALID, '注册能力标签超出节点授权范围')
    }
    const agentVersion = validateAgentVersion(input.agentVersion)
    const osArch = validateOsArch(input.os, input.arch)
    const agentToken = createPlainToken('pagent')
    const now = new Date()
    await db.transaction(async (tx) => {
      const consumed = await consumeRegistrationToken(tx, token.id, now)
      if (!consumed) throw new ApiError(ERROR_CODES.AGENT_REGISTRATION_TOKEN_INVALID, '注册令牌已被使用')
      await revokePipelineNodeTokens(tx, node.id, now)
      await insertPipelineNodeToken(tx, {
        id: randomUUID(),
        teamId: node.team_id,
        nodeId: node.id,
        tokenKind: 'agent',
        tokenHash: hashPipelineToken(agentToken),
        status: 'active',
        expiresAt: null,
      })
      await touchPipelineNode(tx, node.id, {
        status: 'online',
        os: osArch.os,
        arch: osArch.arch,
        capabilities: node.capabilities,
        agentVersion,
        lastHeartbeatAt: now,
        lastErrorCode: null,
      })
    })
    return {
      nodeId: node.id,
      agentToken,
      protocolVersion: AGENT_PROTOCOL_VERSION,
      heartbeatIntervalSeconds: AGENT_HEARTBEAT_INTERVAL_SECONDS,
      leaseTtlSeconds: config.leaseTtlSeconds,
    }
  }

  /**
   * 认证 Agent 请求。
   * @param headers 原始请求头。
   * @returns 已认证节点；节点被停用时拒绝。
   * @throws 令牌缺失、无效、过期或节点停用时抛出 AGENT_TOKEN_INVALID / AGENT_NODE_DISABLED。
   */
  async function authenticateAgent(headers: IncomingHttpHeaders): Promise<AuthenticatedAgentNode> {
    const plain = bearerToken(headers)
    if (plain === null) throw new ApiError(ERROR_CODES.AGENT_TOKEN_INVALID, '缺少 Agent 令牌')
    const token = await findActivePipelineNodeTokenByHash(db, hashPipelineToken(plain))
    if (!token || token.token_kind !== 'agent') {
      throw new ApiError(ERROR_CODES.AGENT_TOKEN_INVALID, 'Agent 令牌无效或已撤销')
    }
    if (token.expires_at !== null && token.expires_at.getTime() <= Date.now()) {
      throw new ApiError(ERROR_CODES.AGENT_TOKEN_INVALID, 'Agent 令牌已过期')
    }
    const node = await findPipelineNodeById(db, token.node_id)
    if (!node) throw new ApiError(ERROR_CODES.AGENT_TOKEN_INVALID, 'Agent 令牌绑定的节点不存在')
    if (node.status === 'disabled') throw new ApiError(ERROR_CODES.AGENT_NODE_DISABLED, '节点已停用')
    return { node }
  }

  async function heartbeat(
    node: PipelineNodeRow,
    input: AgentHeartbeatInput,
  ): Promise<{ cancelLeaseIds: string[]; heartbeatIntervalSeconds: number }> {
    if (node.status === 'disabled') throw new ApiError(ERROR_CODES.AGENT_NODE_DISABLED, '节点已停用')
    const version = input.version.trim()
    if (version.length === 0 || version.length > 40) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Agent 版本不合法')
    }
    const now = new Date()
    // draining/disabled 不因心跳恢复接单；pending/offline 在有效心跳后恢复在线。
    const nextStatus = node.status === 'draining' ? 'draining' : 'online'
    await touchPipelineNode(db, node.id, {
      status: nextStatus,
      agentVersion: version,
      lastHeartbeatAt: now,
    })
    const leases = await findActiveLeasesWithRunStatusByNode(db, node.id)
    return {
      cancelLeaseIds: leases.filter((lease) => lease.run_status === 'cancelling').map((lease) => lease.id),
      heartbeatIntervalSeconds: AGENT_HEARTBEAT_INTERVAL_SECONDS,
    }
  }

  return { listNodes, createNode, drainNode, disableNode, rotateToken, registerAgent, authenticateAgent, heartbeat }
}

export type PipelineNodesService = ReturnType<typeof createPipelineNodesService>
