import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Readable } from 'node:stream'
import type {
  AgentArtifactUploadResponse,
  AgentCompleteResponse,
  AgentLeaseRenewResponse,
  AgentLeaseResponse,
  AgentLogsResponse,
  AgentStepStatusResponse,
  PipelineLease,
  PipelineRunStatus,
  PipelineStepStatus,
  RunPlanGit,
} from '@dev-ops/pipeline-protocol'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { findRepositoryById } from '../code/code.repository.ts'
import { appendPipelineActivity } from './pipeline.activity.ts'
import { hashPipelineToken, type PipelineNodesServiceConfig } from './pipeline.nodes.service.ts'
import {
  countActivePipelineLeases,
  countInFlightRunsForNode,
  findAssignedRunsForNode,
  findClaimableQueuedRuns,
  findPipelineLeaseById,
  insertPipelineLease,
  lockActivePipelineLeaseByRun,
  lockPipelineNode,
  updatePipelineLeaseStatus,
} from './pipeline.nodes.repository.ts'
import {
  findLastPipelineRunLogSeq,
  findPipelineRunById,
  findPipelineRunLogChunk,
  findPipelineRunStep,
  findPipelineRunWithPlan,
  insertPipelineRunLog,
  insertPipelineArtifact,
  findPipelineArtifactByRunName,
  skipPendingPipelineRunSteps,
  sumPipelineRunLogBytes,
  updatePipelineRunStatus,
  updatePipelineRunStepStatus,
} from './pipeline.repository.ts'
import { maskErrorMessage, maskSensitiveText } from './pipeline.mask.ts'
import { materializeRunPlan, type RunPlanTemplate } from './pipeline.planner.ts'
import type { PipelineCredentialProvider } from './pipeline.credentials.ts'
import {
  canTransitionStepStatus,
  collectRunRequirements,
  isPipelineStepStatus,
  isTerminalRunStatus,
  nodeSatisfiesRequirements,
  parseRunPlanTemplate,
} from './pipeline.state.ts'
import { PipelineStorageError, type PipelineStorage } from './pipeline.storage.ts'

/** 单步骤日志总字节上限；超过后拒绝后续分片并按日志超限收口。 */
export const PIPELINE_STEP_LOG_MAX_BYTES = 64 * 1024 * 1024

/** Agent 执行服务配置；由 bootstrap 注入。 */
export interface PipelineAgentServiceConfig {
  leaseTtlSeconds: number
  maxLogChunkBytes: number
  maxArtifactBytes: number
}

/** Agent 执行服务依赖。 */
export interface PipelineAgentServiceDeps {
  db: Database
  config: PipelineAgentServiceConfig
  storage: PipelineStorage
  credentials: PipelineCredentialProvider
}

/** 已认证节点标识；Agent 路由用令牌认证后注入。 */
export interface AgentNodeScope extends PipelineNodesServiceConfig {
  nodeId: string
  teamId: string
  capabilities: string[]
  concurrencyLimit: number
  status: string
}

/** 日志上传输入。 */
export interface AgentLogUploadInput {
  chunks: Array<{ stepIndex: number; seq: number; content: string }>
}

/** 产物上传输入；原始 tar 流与响应头字段。 */
export interface AgentArtifactUploadInput {
  stepIndex: number
  name: string
  sha256: string
  source: Readable
}

/** 完成上报输入。 */
export interface AgentCompleteInput {
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  errorCode?: string | null
  errorMessage?: string | null
}

function safeTokenEquals(expectedHash: string, actualPlain: string): boolean {
  const actual = Buffer.from(hashPipelineToken(actualPlain), 'utf8')
  const expected = Buffer.from(expectedHash, 'utf8')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/**
 * 判断请求声明的 Content-Length 是否已超过产物上限。
 * @param contentLength 原始 Content-Length 请求头；缺失或非法时返回 false，由流式计数兜底。
 * @param maxArtifactBytes 平台产物大小上限（字节）。
 * @returns 明确声明超限时为 true，用于在读取请求体前返回业务错误并避免客户端连接被重置。
 */
export function isDeclaredArtifactOverLimit(contentLength: string | undefined, maxArtifactBytes: number): boolean {
  if (contentLength === undefined) return false
  if (!/^\d{1,20}$/.test(contentLength)) return false
  const declared = Number(contentLength)
  return Number.isFinite(declared) && declared > maxArtifactBytes
}

/**
 * 构造日志序号冲突的错误 data。
 * @param stepIndex 冲突步骤序号。
 * @param acceptedSeq 平台已接受的最大序号；Agent 可从该值之后继续上传。
 * @returns 统一错误 data 形状 `{ acceptedThrough: { "<stepIndex>": maxSeq } }`。
 */
export function logSeqConflictData(
  stepIndex: number,
  acceptedSeq: number,
): {
  acceptedThrough: Record<string, number>
} {
  return { acceptedThrough: { [String(stepIndex)]: acceptedSeq } }
}

/**
 * 创建 Agent 执行服务：租约领取/续约、步骤状态、日志与产物上传、完成收口。
 * @param deps 数据库、存储、配置与 Git/密钥凭据提供者。
 * @returns Agent 协议用例；所有方法的调用方必须已完成节点令牌认证。
 * @remarks 租约明文令牌只在领取响应下发，因此租约在 Agent 领取时创建；
 * Worker 只负责把运行分配给节点，保证数据库只保存租约哈希。
 */
export function createPipelineAgentService(deps: PipelineAgentServiceDeps) {
  const { db, config, storage, credentials } = deps
  // 租约作用域内已解析的运行时密钥短时缓存；明文只在内存，不写日志/数据库/响应。
  const knownSecretsCache = new Map<string, { values: Record<string, string>; expiresAt: number }>()

  /** 读取租约相关运行引用的运行时密钥，用于日志/错误二次脱敏；解析失败时返回空集合。 */
  async function loadKnownSecrets(
    lease: { id: string; expires_at: Date },
    run: { id: string; team_id: string; project_id: string },
  ): Promise<Record<string, string>> {
    const cached = knownSecretsCache.get(lease.id)
    if (cached && cached.expiresAt > Date.now()) return cached.values
    const full = await findPipelineRunWithPlan(db, run.id)
    let secretNames: string[] = []
    if (full) {
      try {
        secretNames = parseRunPlanTemplate(full.run_plan).secretNames
      } catch {
        secretNames = []
      }
    }
    if (secretNames.length === 0) {
      knownSecretsCache.set(lease.id, { values: {}, expiresAt: Date.now() + 60_000 })
      return {}
    }
    try {
      const values = await credentials.resolveSecrets({
        teamId: run.team_id,
        projectId: run.project_id,
        names: secretNames,
      })
      knownSecretsCache.set(lease.id, {
        values,
        expiresAt: Math.min(lease.expires_at.getTime(), Date.now() + 60_000),
      })
      return values
    } catch {
      // 密钥不可用时仍按通用模式脱敏，不阻塞日志上传。
      knownSecretsCache.set(lease.id, { values: {}, expiresAt: Date.now() + 15_000 })
      return {}
    }
  }

  /** 清理租约缓存；租约完成/过期后明文不再保留在内存。 */
  function dropKnownSecrets(leaseId: string): void {
    knownSecretsCache.delete(leaseId)
  }

  function toAgentScope(node: {
    id: string
    team_id: string
    capabilities: string[]
    concurrency_limit: number
    status: string
  }): AgentNodeScope {
    return {
      nodeId: node.id,
      teamId: node.team_id,
      capabilities: node.capabilities,
      concurrencyLimit: node.concurrency_limit,
      status: node.status,
      leaseTtlSeconds: config.leaseTtlSeconds,
    }
  }

  /** 校验租约归属、令牌与有效期；租约令牌以请求头为准。 */
  async function requireLeaseScope(node: AgentNodeScope, leaseId: string, leaseToken: string | null) {
    if (!leaseToken) throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '缺少租约令牌')
    const lease = await findPipelineLeaseById(db, leaseId)
    if (!lease || lease.node_id !== node.nodeId) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约不属于当前节点')
    }
    if (!safeTokenEquals(lease.lease_token_hash, leaseToken)) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约令牌不匹配')
    }
    if (lease.status === 'released') throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约已完成')
    if (lease.status === 'expired' || lease.expires_at.getTime() <= Date.now()) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_EXPIRED, '租约已过期')
    }
    const run = await findPipelineRunById(db, lease.run_id)
    if (!run) throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约对应的运行不存在')
    return { lease, run }
  }

  /** 把运行收口为失败并跳过未开始步骤；用于凭据/密钥解析失败等不可重试原因。 */
  async function failRunAfterDispatchFailure(
    run: { id: string; status: string; team_id: string; project_id: string; triggered_by_user_id: string },
    errorCode: string,
    message: string,
  ): Promise<void> {
    const updated = await updatePipelineRunStatus(db, run.id, [run.status], {
      status: 'failed',
      errorCode,
      errorMessage: maskErrorMessage(message),
      finishedAt: new Date(),
    })
    if (!updated) return
    await skipPendingPipelineRunSteps(db, run.id)
  }

  /**
   * 为节点领取一条运行并创建租约。
   * @param node 已认证节点。
   * @returns 租约与物化后的运行计划；无可用任务时为 null。
   * @remarks 优先领取 Worker 已分配的运行，其次在 Worker 未运行时直接领取排队运行。
   * 凭据与密钥在事务外解析，避免长事务包住外部调用；落库时用条件更新与唯一约束防重复租约。
   */
  async function claimLease(node: AgentNodeScope): Promise<AgentLeaseResponse> {
    if (node.status !== 'online') return null
    const activeCount = await countActivePipelineLeases(db, node.nodeId)
    if (activeCount >= Math.max(1, node.concurrencyLimit)) return null
    const assigned = await findAssignedRunsForNode(db, node.nodeId, 3)
    const candidates: Array<{ runId: string; assignedToNode: boolean }> = assigned.map((row) => ({
      runId: row.id,
      assignedToNode: true,
    }))
    if (candidates.length === 0) {
      const queued = await findClaimableQueuedRuns(db, 20)
      for (const row of queued) candidates.push({ runId: row.id, assignedToNode: false })
    }
    for (const candidate of candidates) {
      const lease = await tryClaimCandidate(node, candidate.runId, candidate.assignedToNode)
      if (lease) return lease
    }
    return null
  }

  async function tryClaimCandidate(
    node: AgentNodeScope,
    runId: string,
    assignedToNode: boolean,
  ): Promise<PipelineLease | null> {
    const run = await findPipelineRunWithPlan(db, runId)
    if (!run || run.team_id !== node.teamId) return null
    if (run.status !== 'queued' && !(assignedToNode && run.status === 'assigned' && run.node_id === node.nodeId)) {
      return null
    }
    let template: RunPlanTemplate
    try {
      template = parseRunPlanTemplate(run.run_plan)
    } catch {
      return null
    }
    const requirements = collectRunRequirements(template)
    if (!nodeSatisfiesRequirements(node.capabilities, requirements)) return null
    const repository = await findRepositoryById(db, run.repository_id)
    if (!repository) {
      await failRunAfterDispatchFailure(
        {
          id: run.id,
          status: run.status,
          team_id: run.team_id,
          project_id: run.project_id,
          triggered_by_user_id: run.triggered_by_user_id,
        },
        ERROR_CODES.PIPELINE_REPOSITORY_UNAVAILABLE,
        '运行关联的仓库不存在',
      )
      return null
    }
    let git: RunPlanGit
    let secrets: Record<string, string>
    try {
      git = await credentials.issueGitCredential({
        teamId: run.team_id,
        connectionId: repository.connection_id,
        webUrl: repository.web_url,
        commitSha: run.commit_sha,
      })
      secrets = await credentials.resolveSecrets({
        teamId: run.team_id,
        projectId: run.project_id,
        names: template.secretNames,
      })
    } catch (error) {
      const code =
        error instanceof ApiError
          ? error.code
          : error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : ERROR_CODES.PIPELINE_GIT_CREDENTIAL_ERROR
      const message = error instanceof Error ? error.message : '运行凭据不可用'
      await failRunAfterDispatchFailure(
        {
          id: run.id,
          status: run.status,
          team_id: run.team_id,
          project_id: run.project_id,
          triggered_by_user_id: run.triggered_by_user_id,
        },
        code,
        `运行凭据不可用：${message}`,
      )
      return null
    }
    const plan = materializeRunPlan(template, { git, secrets })
    const leaseToken = `pl_${randomBytes(32).toString('base64url')}`
    const leaseId = randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.leaseTtlSeconds * 1000)
    try {
      await db.transaction(async (tx) => {
        const lockedNode = await lockPipelineNode(tx, node.nodeId)
        if (!lockedNode || lockedNode.status !== 'online' || lockedNode.disabled_at !== null) {
          throw new LeaseClaimConflictError()
        }
        const existingLease = await lockActivePipelineLeaseByRun(tx, run.id)
        if (existingLease) throw new AlreadyLeasedError()
        // 直接领取排队运行时，节点容量按在途运行数判断；已分配运行本身已计入容量。
        if (run.status === 'queued') {
          const inFlight = await countInFlightRunsForNode(tx, node.nodeId)
          if (inFlight >= lockedNode.concurrency_limit) throw new AlreadyLeasedError()
        }
        const fromStatuses = run.status === 'queued' ? ['queued'] : ['assigned']
        const updated = await updatePipelineRunStatus(tx, run.id, fromStatuses, {
          status: 'assigned',
          nodeId: node.nodeId,
          assignedAt: run.assigned_at ?? now,
        })
        if (!updated) throw new LeaseClaimConflictError()
        await insertPipelineLease(tx, {
          id: leaseId,
          teamId: run.team_id,
          projectId: run.project_id,
          runId: run.id,
          nodeId: node.nodeId,
          leaseTokenHash: hashPipelineToken(leaseToken),
          expiresAt,
        })
      })
    } catch (error) {
      if (error instanceof AlreadyLeasedError || error instanceof LeaseClaimConflictError) return null
      throw error
    }
    return {
      leaseId,
      leaseToken,
      expiresAt: expiresAt.toISOString(),
      heartbeatIntervalSeconds: 15,
      run: plan,
    }
  }

  /** 续约；运行取消中时返回 cancelRequested=true，Agent 必须尽快停止。 */
  async function renewLease(
    node: AgentNodeScope,
    leaseId: string,
    leaseToken: string | null,
    bodyLeaseToken: string,
  ): Promise<AgentLeaseRenewResponse> {
    if (leaseToken === null || bodyLeaseToken !== leaseToken) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约令牌不匹配')
    }
    const { run } = await requireLeaseScope(node, leaseId, leaseToken)
    if (isTerminalRunStatus(run.status)) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '运行已结束')
    }
    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.leaseTtlSeconds * 1000)
    const updated = await updatePipelineLeaseStatus(db, leaseId, ['active'], { expiresAt, renewedAt: now })
    if (!updated) throw new ApiError(ERROR_CODES.AGENT_LEASE_EXPIRED, '租约已过期或被释放')
    return { expiresAt: expiresAt.toISOString(), cancelRequested: run.status === 'cancelling' }
  }

  /** 上报步骤状态；非法转换返回 AGENT_STEP_STATE_CONFLICT，重复状态幂等返回。 */
  async function reportStepStatus(
    node: AgentNodeScope,
    leaseId: string,
    stepIndex: number,
    leaseToken: string | null,
    input: {
      status: PipelineStepStatus
      exitCode?: number | null
      errorCode?: string | null
      errorMessage?: string | null
    },
  ): Promise<AgentStepStatusResponse> {
    const { lease, run } = await requireLeaseScope(node, leaseId, leaseToken)
    if (isTerminalRunStatus(run.status)) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '运行已结束，拒绝步骤上报')
    }
    const step = await findPipelineRunStep(db, run.id, stepIndex)
    if (!step) throw new ApiError(ERROR_CODES.AGENT_STEP_STATE_CONFLICT, '步骤不存在')
    if (!canTransitionStepStatus(step.status, input.status)) {
      throw new ApiError(ERROR_CODES.AGENT_STEP_STATE_CONFLICT, '步骤状态转换不合法')
    }
    if (step.status === input.status) {
      return { stepIndex, status: step.status }
    }
    const knownSecrets = Object.values(await loadKnownSecrets(lease, run))
    const now = new Date()
    const updated = await updatePipelineRunStepStatus(db, run.id, stepIndex, [step.status], {
      status: input.status,
      ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: maskErrorMessage(input.errorMessage, knownSecrets) }),
      ...(input.status === 'running' ? { startedAt: step.started_at ?? now } : {}),
      ...(input.status === 'succeeded' ||
      input.status === 'failed' ||
      input.status === 'skipped' ||
      input.status === 'cancelled'
        ? { finishedAt: now }
        : {}),
    })
    if (!updated) throw new ApiError(ERROR_CODES.AGENT_STEP_STATE_CONFLICT, '步骤状态已变化，请刷新后重试')
    if (input.status === 'running' && run.status === 'assigned') {
      await updatePipelineRunStatus(db, run.id, ['assigned'], { status: 'running', startedAt: now })
    }
    if (!isPipelineStepStatus(updated.status)) throw new Error(`数据库步骤状态不合法: ${updated.status}`)
    return { stepIndex, status: updated.status }
  }

  /** 上传日志分片；按步骤内序号幂等，重复分片不重复写文件。 */
  async function uploadLogs(
    node: AgentNodeScope,
    leaseId: string,
    leaseToken: string | null,
    input: AgentLogUploadInput,
  ): Promise<AgentLogsResponse> {
    const { lease, run } = await requireLeaseScope(node, leaseId, leaseToken)
    if (isTerminalRunStatus(run.status)) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '运行已结束，拒绝日志上传')
    }
    const knownSecrets = Object.values(await loadKnownSecrets(lease, run))
    let totalBytes = 0
    for (const chunk of input.chunks) {
      const size = Buffer.byteLength(chunk.content, 'utf8')
      if (size > config.maxLogChunkBytes) {
        throw new ApiError(ERROR_CODES.AGENT_LOG_LIMIT_EXCEEDED, '日志分片超过大小上限')
      }
      totalBytes += size
    }
    if (totalBytes > config.maxLogChunkBytes) {
      throw new ApiError(ERROR_CODES.AGENT_LOG_LIMIT_EXCEEDED, '单次日志上传总量超过上限')
    }
    const acceptedThrough: Record<string, number> = {}
    for (const chunk of input.chunks) {
      const step = await findPipelineRunStep(db, run.id, chunk.stepIndex)
      if (!step) throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '日志步骤不属于当前运行')
      const lastSeq = await findLastPipelineRunLogSeq(db, run.id, chunk.stepIndex)
      if (chunk.seq <= lastSeq) {
        const existing = await findPipelineRunLogChunk(db, run.id, chunk.stepIndex, chunk.seq)
        if (existing) {
          acceptedThrough[String(chunk.stepIndex)] = Math.max(acceptedThrough[String(chunk.stepIndex)] ?? -1, lastSeq)
          continue
        }
        throw new ApiError(
          ERROR_CODES.AGENT_LOG_SEQ_CONFLICT,
          '日志序号回退或缺失',
          logSeqConflictData(chunk.stepIndex, lastSeq),
        )
      }
      const existingBytes = await sumPipelineRunLogBytes(db, run.id, chunk.stepIndex)
      const sizeBytes = Buffer.byteLength(chunk.content, 'utf8')
      if (existingBytes + sizeBytes > PIPELINE_STEP_LOG_MAX_BYTES) {
        throw new ApiError(ERROR_CODES.AGENT_LOG_LIMIT_EXCEEDED, '单步骤日志总量超过上限')
      }
      const content = maskSensitiveText(chunk.content, knownSecrets)
      let stored: { storageKey: string; sizeBytes: number }
      try {
        stored = await storage.writeLogChunk(run.id, chunk.stepIndex, chunk.seq, content)
      } catch (error) {
        if (error instanceof PipelineStorageError) {
          throw new ApiError(ERROR_CODES.PIPELINE_STORAGE_ERROR, error.message)
        }
        throw error
      }
      await insertPipelineRunLog(db, {
        id: randomUUID(),
        teamId: run.team_id,
        projectId: run.project_id,
        runId: run.id,
        stepIndex: chunk.stepIndex,
        seq: chunk.seq,
        storageKey: stored.storageKey,
        sizeBytes: stored.sizeBytes,
      })
      acceptedThrough[String(chunk.stepIndex)] = Math.max(acceptedThrough[String(chunk.stepIndex)] ?? -1, chunk.seq)
    }
    return { acceptedThrough }
  }

  /** 上传产物原始流；校验大小与 SHA-256，同名产物返回冲突而不是覆盖。 */
  async function uploadArtifact(
    node: AgentNodeScope,
    leaseId: string,
    leaseToken: string | null,
    input: AgentArtifactUploadInput,
  ): Promise<AgentArtifactUploadResponse> {
    const { run } = await requireLeaseScope(node, leaseId, leaseToken)
    if (isTerminalRunStatus(run.status)) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '运行已结束，拒绝产物上传')
    }
    const step = await findPipelineRunStep(db, run.id, input.stepIndex)
    if (!step || step.kind !== 'builtin_upload_artifact') {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '产物上传步骤不属于当前运行的内置产物步骤')
    }
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(input.name)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '产物名不合法')
    }
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '产物校验和格式不合法')
    }
    if (await findPipelineArtifactByRunName(db, run.id, input.name)) {
      throw new ApiError(ERROR_CODES.PIPELINE_ARTIFACT_CONFLICT, '同一运行已存在同名产物')
    }
    const artifactId = randomUUID()
    let stored: { storageKey: string; sizeBytes: number; sha256: string }
    try {
      stored = await storage.writeArtifactStream(run.id, artifactId, input.source, input.sha256)
    } catch (error) {
      if (error instanceof PipelineStorageError) {
        if (error.message.includes('超过大小上限')) {
          throw new ApiError(ERROR_CODES.AGENT_ARTIFACT_LIMIT_EXCEEDED, '产物超过大小上限')
        }
        if (error.message.includes('校验和')) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '产物校验和不一致')
        throw new ApiError(ERROR_CODES.PIPELINE_STORAGE_ERROR, error.message)
      }
      throw error
    }
    try {
      await insertPipelineArtifact(db, {
        id: artifactId,
        teamId: run.team_id,
        projectId: run.project_id,
        runId: run.id,
        stepIndex: input.stepIndex,
        name: input.name,
        storageKey: stored.storageKey,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        status: 'available',
      })
    } catch {
      await storage.removeArtifact(stored.storageKey)
      throw new ApiError(ERROR_CODES.PIPELINE_ARTIFACT_CONFLICT, '同一运行已存在同名产物')
    }
    return { artifactId, name: input.name, sizeBytes: stored.sizeBytes, sha256: stored.sha256 }
  }

  /** 完成运行并释放租约；重复完成返回同一结果，终态冲突拒绝。 */
  async function completeLease(
    node: AgentNodeScope,
    leaseId: string,
    leaseToken: string | null,
    input: AgentCompleteInput,
  ): Promise<AgentCompleteResponse> {
    if (!leaseToken) throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '缺少租约令牌')
    const lease = await findPipelineLeaseById(db, leaseId)
    if (!lease || lease.node_id !== node.nodeId) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约不属于当前节点')
    }
    if (!safeTokenEquals(lease.lease_token_hash, leaseToken)) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约令牌不匹配')
    }
    const run = await findPipelineRunById(db, lease.run_id)
    if (!run) throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '租约对应的运行不存在')
    if (lease.status === 'released') {
      // 重复完成：返回同一终态，不重复写活动或状态。
      return { runId: run.id, status: toRunStatus(run.status) }
    }
    if (lease.status === 'expired' || lease.expires_at.getTime() <= Date.now()) {
      throw new ApiError(ERROR_CODES.AGENT_LEASE_EXPIRED, '租约已过期')
    }
    if (isTerminalRunStatus(run.status)) {
      // 平台已通过取消/超时/中断收口运行：释放残留租约并返回平台终态，Agent 上报不得翻转成功。
      await updatePipelineLeaseStatus(db, leaseId, ['active'], { status: 'released', releasedAt: new Date() })
      return { runId: run.id, status: toRunStatus(run.status) }
    }
    const knownSecrets = Object.values(await loadKnownSecrets(lease, run))
    const now = new Date()
    const targetStatus = resolveCompletionStatus(run.status, run.error_code, input)
    const errorCode = resolveCompletionErrorCode(targetStatus, run.error_code, input)
    try {
      await db.transaction(async (tx) => {
        const updated = await updatePipelineRunStatus(tx, run.id, [run.status], {
          status: targetStatus,
          errorCode,
          // Agent 未提供说明时保留取消/失败已有原因；两者都为空则写入 null，不写空字符串。
          errorMessage:
            maskErrorMessage(input.errorMessage, knownSecrets) ?? maskErrorMessage(run.error_message) ?? null,
          finishedAt: now,
        })
        if (!updated) throw new ApiError(ERROR_CODES.AGENT_LEASE_INVALID, '运行状态已变化')
        await updatePipelineLeaseStatus(tx, leaseId, ['active'], { status: 'released', releasedAt: now })
        await skipPendingPipelineRunSteps(tx, run.id)
        await appendPipelineActivity(tx, {
          teamId: run.team_id,
          projectId: run.project_id,
          entityType: 'pipeline_run',
          entityId: run.id,
          action: 'pipeline_run_completed',
          actorUserId: run.triggered_by_user_id,
          changes: { status: targetStatus, errorCode },
        })
      })
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw error
    }
    dropKnownSecrets(leaseId)
    return { runId: run.id, status: targetStatus }
  }

  return {
    toAgentScope,
    claimLease,
    renewLease,
    reportStepStatus,
    uploadLogs,
    uploadArtifact,
    completeLease,
  }
}

/** 内部错误：运行已被其他节点领取；不映射为业务错误，直接放弃候选。 */
class AlreadyLeasedError extends Error {
  constructor() {
    super('运行已有活动租约')
    this.name = 'AlreadyLeasedError'
  }
}

/** 内部错误：条件更新未命中，说明运行被并发修改。 */
class LeaseClaimConflictError extends Error {
  constructor() {
    super('运行状态已变化')
    this.name = 'LeaseClaimConflictError'
  }
}

/** 把数据库 text 状态收窄为响应可用的运行状态；数据库值不合法时按内部错误处理。 */
function toRunStatus(status: string): PipelineRunStatus {
  if (
    status === 'queued' ||
    status === 'assigned' ||
    status === 'running' ||
    status === 'cancelling' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted'
  ) {
    return status
  }
  throw new Error(`数据库运行状态不合法: ${status}`)
}

/**
 * 计算完成后的运行终态：平台取消的运行不能上报成功；运行级超时按失败收口。
 * @param currentStatus 当前运行状态。
 * @param currentErrorCode 运行已记录的 error_code（如 RUN_TIMEOUT）。
 * @param input Agent 完成上报。
 * @returns 目标终态。
 */
function resolveCompletionStatus(
  currentStatus: string,
  currentErrorCode: string | null,
  input: AgentCompleteInput,
): PipelineRunStatus {
  const isCancelling = currentStatus === 'cancelling'
  if (currentErrorCode === 'RUN_TIMEOUT') {
    return input.status === 'interrupted' ? 'interrupted' : 'failed'
  }
  if (isCancelling && input.status === 'succeeded') return 'cancelled'
  return input.status
}

/** 计算完成后的业务错误码；成功清空错误，取消/失败/中断保留可读分类。 */
function resolveCompletionErrorCode(
  targetStatus: PipelineRunStatus,
  currentErrorCode: string | null,
  input: AgentCompleteInput,
): string | null {
  if (targetStatus === 'succeeded') return null
  if (currentErrorCode === 'RUN_TIMEOUT') return 'RUN_TIMEOUT'
  if (targetStatus === 'cancelled') return 'CANCELLED'
  return input.errorCode ?? (targetStatus === 'interrupted' ? 'INTERRUPTED' : 'STEP_FAILED')
}

export type PipelineAgentService = ReturnType<typeof createPipelineAgentService>

// 保留依赖注入类型引用，确保路由层按相同契约传递配置。
export type { PipelineNodesServiceConfig }
