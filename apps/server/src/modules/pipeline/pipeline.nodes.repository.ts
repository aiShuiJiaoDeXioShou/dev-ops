import { and, asc, count, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import type { PipelineExecutor } from './pipeline.repository.ts'
import { pipelineLease, pipelineNode, pipelineNodeToken, pipelineRun } from './pipeline.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]

/** 节点表显式字段投影；不含任何令牌字段。 */
const nodeColumns = {
  id: pipelineNode.id,
  team_id: pipelineNode.team_id,
  name: pipelineNode.name,
  status: pipelineNode.status,
  os: pipelineNode.os,
  arch: pipelineNode.arch,
  capabilities: pipelineNode.capabilities,
  concurrency_limit: pipelineNode.concurrency_limit,
  agent_version: pipelineNode.agent_version,
  last_heartbeat_at: pipelineNode.last_heartbeat_at,
  last_error_code: pipelineNode.last_error_code,
  created_by_user_id: pipelineNode.created_by_user_id,
  disabled_at: pipelineNode.disabled_at,
  disabled_by_user_id: pipelineNode.disabled_by_user_id,
  created_at: pipelineNode.created_at,
  updated_at: pipelineNode.updated_at,
} as const

const tokenColumns = {
  id: pipelineNodeToken.id,
  team_id: pipelineNodeToken.team_id,
  node_id: pipelineNodeToken.node_id,
  token_kind: pipelineNodeToken.token_kind,
  status: pipelineNodeToken.status,
  expires_at: pipelineNodeToken.expires_at,
  used_at: pipelineNodeToken.used_at,
  revoked_at: pipelineNodeToken.revoked_at,
  created_at: pipelineNodeToken.created_at,
} as const

const leaseColumns = {
  id: pipelineLease.id,
  team_id: pipelineLease.team_id,
  project_id: pipelineLease.project_id,
  run_id: pipelineLease.run_id,
  node_id: pipelineLease.node_id,
  lease_token_hash: pipelineLease.lease_token_hash,
  status: pipelineLease.status,
  expires_at: pipelineLease.expires_at,
  renewed_at: pipelineLease.renewed_at,
  released_at: pipelineLease.released_at,
  created_at: pipelineLease.created_at,
} as const

/** 节点行；不含令牌哈希等敏感字段。 */
export type PipelineNodeRow = NonNullable<Awaited<ReturnType<typeof findPipelineNodeById>>>

/** 新建节点输入。 */
export interface NewPipelineNode {
  id: string
  teamId: string
  name: string
  status: string
  os: string
  arch: string
  capabilities: string[]
  concurrencyLimit: number
  createdByUserId: string
}

/** 新建节点令牌输入；只保存哈希。 */
export interface NewPipelineNodeToken {
  id: string
  teamId: string
  nodeId: string
  tokenKind: string
  tokenHash: string
  status: string
  expiresAt: Date | null
}

/** 节点条件更新的可写字段。 */
export interface PipelineNodeUpdateFields {
  status?: string
  os?: string
  arch?: string
  capabilities?: string[]
  agentVersion?: string | null
  lastHeartbeatAt?: Date
  lastErrorCode?: string | null
  disabledAt?: Date | null
  disabledByUserId?: string | null
}

/** 插入节点；团队内名称唯一由数据库唯一约束兜底。 */
export async function insertPipelineNode(executor: PipelineExecutor, input: NewPipelineNode) {
  const [row] = await executor
    .insert(pipelineNode)
    .values({
      id: input.id,
      team_id: input.teamId,
      name: input.name,
      status: input.status,
      os: input.os,
      arch: input.arch,
      capabilities: input.capabilities,
      concurrency_limit: input.concurrencyLimit,
      created_by_user_id: input.createdByUserId,
    })
    .returning(nodeColumns)
  return row
}

/** 查询团队节点列表；按创建时间倒序。 */
export async function findPipelineNodes(db: Database, teamId: string) {
  return db
    .select(nodeColumns)
    .from(pipelineNode)
    .where(eq(pipelineNode.team_id, teamId))
    .orderBy(sql`${pipelineNode.created_at} desc`, sql`${pipelineNode.id} desc`)
}

/** 按标识查找节点。 */
export async function findPipelineNodeById(db: PipelineExecutor, nodeId: string) {
  const [row] = await db.select(nodeColumns).from(pipelineNode).where(eq(pipelineNode.id, nodeId)).limit(1)
  return row
}

/** 按团队与名称查找节点，用于团队内名称冲突的友好错误。 */
export async function findPipelineNodeByTeamName(db: PipelineExecutor, teamId: string, name: string) {
  const [row] = await db
    .select({ id: pipelineNode.id })
    .from(pipelineNode)
    .where(and(eq(pipelineNode.team_id, teamId), eq(pipelineNode.name, name)))
    .limit(1)
  return row
}

/**
 * 以当前状态集合为条件更新节点。
 * @returns 更新后的节点行；状态不匹配时返回 undefined。
 */
export async function updatePipelineNodeStatus(
  executor: PipelineExecutor,
  nodeId: string,
  fromStatuses: string[],
  fields: PipelineNodeUpdateFields,
) {
  if (fromStatuses.length === 0) return undefined
  const [row] = await executor
    .update(pipelineNode)
    .set({
      status: fields.status ?? undefined,
      os: fields.os ?? undefined,
      arch: fields.arch ?? undefined,
      capabilities: fields.capabilities ?? undefined,
      agent_version: fields.agentVersion ?? undefined,
      last_heartbeat_at: fields.lastHeartbeatAt ?? undefined,
      last_error_code: fields.lastErrorCode ?? undefined,
      disabled_at: fields.disabledAt ?? undefined,
      disabled_by_user_id: fields.disabledByUserId ?? undefined,
      updated_at: new Date(),
    })
    .where(and(eq(pipelineNode.id, nodeId), inArray(pipelineNode.status, fromStatuses)))
    .returning(nodeColumns)
  return row
}

/** 无条件更新节点心跳/版本等运行信息；状态单独用条件更新。 */
export async function touchPipelineNode(executor: PipelineExecutor, nodeId: string, fields: PipelineNodeUpdateFields) {
  const [row] = await executor
    .update(pipelineNode)
    .set({
      status: fields.status ?? undefined,
      os: fields.os ?? undefined,
      arch: fields.arch ?? undefined,
      capabilities: fields.capabilities ?? undefined,
      agent_version: fields.agentVersion ?? undefined,
      last_heartbeat_at: fields.lastHeartbeatAt ?? undefined,
      last_error_code: fields.lastErrorCode ?? undefined,
      updated_at: new Date(),
    })
    .where(eq(pipelineNode.id, nodeId))
    .returning(nodeColumns)
  return row
}

/** 查询在线且未停用的节点；能力匹配由调用方完成。 */
export async function findOnlinePipelineNodes(db: PipelineExecutor) {
  return db
    .select(nodeColumns)
    .from(pipelineNode)
    .where(and(eq(pipelineNode.status, 'online'), isNull(pipelineNode.disabled_at)))
    .orderBy(asc(pipelineNode.last_heartbeat_at), asc(pipelineNode.id))
}

/** 按状态批量查询节点；Worker 收口离线/停用节点上的运行时使用。 */
export async function findPipelineNodesByStatuses(db: PipelineExecutor, statuses: string[]) {
  if (statuses.length === 0) return []
  return db
    .select(nodeColumns)
    .from(pipelineNode)
    .where(inArray(pipelineNode.status, statuses))
    .orderBy(asc(pipelineNode.id))
}

/**
 * 将心跳超时的在线节点置为离线。
 * @param db 数据库连接。
 * @param cutoff 心跳早于该时间视为超时。
 * @returns 被置为离线的节点行，供 Worker 收口其运行。
 */
export async function markStalePipelineNodesOffline(db: Database, cutoff: Date) {
  return db
    .update(pipelineNode)
    .set({ status: 'offline', last_error_code: 'HEARTBEAT_TIMEOUT', updated_at: new Date() })
    .where(
      and(
        eq(pipelineNode.status, 'online'),
        sql`(${pipelineNode.last_heartbeat_at} is null or ${pipelineNode.last_heartbeat_at} < ${cutoff})`,
      ),
    )
    .returning(nodeColumns)
}

/** 按标识批量查询节点名称，供运行详情的节点摘要使用。 */
export async function findPipelineNodeSummariesByIds(db: Database, nodeIds: string[]) {
  const ids = [...new Set(nodeIds)].slice(0, 100)
  if (ids.length === 0) return []
  return db
    .select({ id: pipelineNode.id, name: pipelineNode.name, status: pipelineNode.status })
    .from(pipelineNode)
    .where(inArray(pipelineNode.id, ids))
}

/** 插入节点令牌；只保存 SHA-256 哈希，明文只在创建响应返回一次。 */
export async function insertPipelineNodeToken(executor: PipelineExecutor, input: NewPipelineNodeToken) {
  const [row] = await executor
    .insert(pipelineNodeToken)
    .values({
      id: input.id,
      team_id: input.teamId,
      node_id: input.nodeId,
      token_kind: input.tokenKind,
      token_hash: input.tokenHash,
      status: input.status,
      expires_at: input.expiresAt,
    })
    .returning(tokenColumns)
  return row
}

/** 按令牌哈希查找活动令牌；令牌明文不参与查询。 */
export async function findActivePipelineNodeTokenByHash(db: PipelineExecutor, tokenHash: string) {
  const [row] = await db
    .select(tokenColumns)
    .from(pipelineNodeToken)
    .where(and(eq(pipelineNodeToken.token_hash, tokenHash), eq(pipelineNodeToken.status, 'active')))
    .limit(1)
  return row
}

/**
 * 将活动注册令牌标记为已使用；条件更新保证一次性令牌不会被并发使用两次。
 * @returns 更新后的令牌行；已被使用或撤销时返回 undefined。
 */
export async function consumeRegistrationToken(executor: PipelineExecutor, tokenId: string, at: Date) {
  const [row] = await executor
    .update(pipelineNodeToken)
    .set({ status: 'used', used_at: at, updated_at: at })
    .where(and(eq(pipelineNodeToken.id, tokenId), eq(pipelineNodeToken.status, 'active')))
    .returning(tokenColumns)
  return row
}

/** 撤销节点的全部活动令牌；轮换与停用时调用。 */
export async function revokePipelineNodeTokens(executor: PipelineExecutor, nodeId: string, at: Date) {
  const rows = await executor
    .update(pipelineNodeToken)
    .set({ status: 'revoked', revoked_at: at, updated_at: at })
    .where(and(eq(pipelineNodeToken.node_id, nodeId), eq(pipelineNodeToken.status, 'active')))
    .returning({ id: pipelineNodeToken.id })
  return rows.length
}

/** 插入租约；活动租约唯一性由部分唯一索引 uk_pipeline_lease_active_run 兜底。 */
export async function insertPipelineLease(
  executor: PipelineExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    runId: string
    nodeId: string
    leaseTokenHash: string
    expiresAt: Date
  },
) {
  const [row] = await executor
    .insert(pipelineLease)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      run_id: input.runId,
      node_id: input.nodeId,
      lease_token_hash: input.leaseTokenHash,
      status: 'active',
      expires_at: input.expiresAt,
    })
    .returning(leaseColumns)
  return row
}

/** 查询运行的当前活动租约。 */
export async function findActivePipelineLeaseByRun(db: PipelineExecutor, runId: string) {
  const [row] = await db
    .select(leaseColumns)
    .from(pipelineLease)
    .where(and(eq(pipelineLease.run_id, runId), eq(pipelineLease.status, 'active')))
    .limit(1)
  return row
}

/** 在事务内锁定运行的活动租约，避免并发创建第二个租约。 */
export async function lockActivePipelineLeaseByRun(tx: TransactionDatabase, runId: string) {
  const [row] = await tx
    .select(leaseColumns)
    .from(pipelineLease)
    .where(and(eq(pipelineLease.run_id, runId), eq(pipelineLease.status, 'active')))
    .limit(1)
    .for('update')
  return row
}

/** 按标识查找租约。 */
export async function findPipelineLeaseById(db: PipelineExecutor, leaseId: string) {
  const [row] = await db.select(leaseColumns).from(pipelineLease).where(eq(pipelineLease.id, leaseId)).limit(1)
  return row
}

/**
 * 以当前状态为条件更新租约；续约、释放与过期都以 active 为前提。
 * @returns 更新后的租约；状态不匹配时返回 undefined。
 */
export async function updatePipelineLeaseStatus(
  executor: PipelineExecutor,
  leaseId: string,
  fromStatuses: string[],
  fields: { status?: string; expiresAt?: Date; renewedAt?: Date; releasedAt?: Date },
) {
  if (fromStatuses.length === 0) return undefined
  const [row] = await executor
    .update(pipelineLease)
    .set({
      status: fields.status ?? undefined,
      expires_at: fields.expiresAt ?? undefined,
      renewed_at: fields.renewedAt ?? undefined,
      released_at: fields.releasedAt ?? undefined,
      updated_at: new Date(),
    })
    .where(and(eq(pipelineLease.id, leaseId), inArray(pipelineLease.status, fromStatuses)))
    .returning(leaseColumns)
  return row
}

/** 查询已过期但未收口的活动租约。 */
export async function findExpiredPipelineLeases(db: Database, now: Date) {
  return db
    .select(leaseColumns)
    .from(pipelineLease)
    .where(and(eq(pipelineLease.status, 'active'), lte(pipelineLease.expires_at, now)))
}

/**
 * 查询节点当前活动租约及其运行状态；心跳据此下发取消通知。
 * @returns 租约行与运行状态的组合，取消中运行的租约需要 Agent 尽快停止。
 */
export async function findActiveLeasesWithRunStatusByNode(db: Database, nodeId: string) {
  return db
    .select({
      id: pipelineLease.id,
      run_id: pipelineLease.run_id,
      run_status: pipelineRun.status,
    })
    .from(pipelineLease)
    .innerJoin(pipelineRun, eq(pipelineRun.id, pipelineLease.run_id))
    .where(and(eq(pipelineLease.node_id, nodeId), eq(pipelineLease.status, 'active')))
}

/** 在事务内锁定节点行，串行化同一节点的容量判断与分配。 */
export async function lockPipelineNode(tx: TransactionDatabase, nodeId: string) {
  const [row] = await tx
    .select(nodeColumns)
    .from(pipelineNode)
    .where(eq(pipelineNode.id, nodeId))
    .limit(1)
    .for('update')
  return row
}

/**
 * 统计单个节点在途运行数量（assigned/running/cancelling）。
 * @param executor 数据库连接或事务；容量判断必须在持节点行锁的事务内调用。
 * @param nodeId 节点标识。
 * @returns 在途运行数。
 */
export async function countInFlightRunsForNode(executor: PipelineExecutor, nodeId: string) {
  const [row] = await executor
    .select({ total: count() })
    .from(pipelineRun)
    .where(and(eq(pipelineRun.node_id, nodeId), inArray(pipelineRun.status, ['assigned', 'running', 'cancelling'])))
  return Number(row?.total ?? 0)
}

/**
 * 统计多个节点在途运行数量（assigned/running/cancelling）。
 * @param db 数据库连接。
 * @param nodeIds 节点标识集合。
 * @returns 节点标识到在途运行数的投影；租约在 Agent 领取时才创建，容量必须按运行状态统计。
 */
export async function countInFlightRunsByNodeIds(db: PipelineExecutor, nodeIds: string[]) {
  const ids = [...new Set(nodeIds)]
  if (ids.length === 0) return []
  return db
    .select({ nodeId: pipelineRun.node_id, total: count() })
    .from(pipelineRun)
    .where(and(inArray(pipelineRun.node_id, ids), inArray(pipelineRun.status, ['assigned', 'running', 'cancelling'])))
    .groupBy(pipelineRun.node_id)
}

/** 批量读取节点当前活动租约对应的运行标识，用于节点列表展示 currentRunId。 */
export async function findActiveLeaseRunIdsByNodeIds(db: Database, nodeIds: string[]) {
  const ids = [...new Set(nodeIds)].slice(0, 100)
  if (ids.length === 0) return []
  return db
    .select({ nodeId: pipelineLease.node_id, runId: pipelineLease.run_id })
    .from(pipelineLease)
    .where(and(inArray(pipelineLease.node_id, ids), eq(pipelineLease.status, 'active')))
}

/** 查询节点当前活动租约数量。 */
export async function countActivePipelineLeases(db: PipelineExecutor, nodeId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(pipelineLease)
    .where(and(eq(pipelineLease.node_id, nodeId), eq(pipelineLease.status, 'active')))
  return Number(row?.total ?? 0)
}

/**
 * 查询分配给指定节点、等待领取且没有活动租约的运行。
 * @param db 数据库连接。
 * @param nodeId 节点标识。
 * @param limit 最多读取条数，按分配时间升序。
 * @returns 运行摘要行；Agent 领取租约时优先使用这些已分配运行。
 */
export async function findAssignedRunsForNode(db: PipelineExecutor, nodeId: string, limit: number) {
  return db
    .select({
      id: pipelineRun.id,
      team_id: pipelineRun.team_id,
      project_id: pipelineRun.project_id,
      status: pipelineRun.status,
      assigned_at: pipelineRun.assigned_at,
    })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.node_id, nodeId),
        eq(pipelineRun.status, 'assigned'),
        sql`not exists (select 1 from app.pipeline_lease lease where lease.run_id = ${pipelineRun.id} and lease.status = 'active')`,
      ),
    )
    .orderBy(asc(pipelineRun.assigned_at), asc(pipelineRun.id))
    .limit(limit)
}

/**
 * 查询可以被节点直接领取的排队运行（Worker 未预先分配时的兜底路径）。
 * @returns 排队运行摘要；能力标签匹配由 service 在读取运行计划后判断。
 */
export async function findClaimableQueuedRuns(db: PipelineExecutor, limit: number) {
  return db
    .select({
      id: pipelineRun.id,
      team_id: pipelineRun.team_id,
      project_id: pipelineRun.project_id,
      status: pipelineRun.status,
      created_at: pipelineRun.created_at,
    })
    .from(pipelineRun)
    .where(eq(pipelineRun.status, 'queued'))
    .orderBy(asc(pipelineRun.created_at), asc(pipelineRun.id))
    .limit(limit)
}

/**
 * 查询指定节点上处于指定状态且没有活动租约的运行，用于离线/停用收口。
 * @param db 数据库连接。
 * @param nodeId 节点标识。
 * @param statuses 需要收口的运行状态。
 */
export async function findRunsForNodeWithoutLease(db: Database, nodeId: string, statuses: string[]) {
  if (statuses.length === 0) return []
  return db
    .select({ id: pipelineRun.id, status: pipelineRun.status, project_id: pipelineRun.project_id })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.node_id, nodeId),
        inArray(pipelineRun.status, statuses),
        sql`not exists (select 1 from app.pipeline_lease lease where lease.run_id = ${pipelineRun.id} and lease.status = 'active')`,
      ),
    )
}
