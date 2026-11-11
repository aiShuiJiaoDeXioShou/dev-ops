import type { Database } from '../../platform/database/client.ts'
import {
  countInFlightRunsByNodeIds,
  countInFlightRunsForNode,
  findActiveLeasesWithRunStatusByNode,
  findExpiredPipelineLeases,
  findOnlinePipelineNodes,
  findPipelineNodesByStatuses,
  findRunsForNodeWithoutLease,
  lockPipelineNode,
  markStalePipelineNodesOffline,
  updatePipelineLeaseStatus,
} from './pipeline.nodes.repository.ts'
import {
  claimQueuedPipelineRun,
  findPipelineRunById,
  findPipelineRunsByStatuses,
  findPipelineRunWithPlan,
  skipPendingPipelineRunSteps,
  updatePipelineRunStatus,
} from './pipeline.repository.ts'
import {
  collectRunRequirements,
  isTerminalRunStatus,
  nodeSatisfiesRequirements,
  parseRunPlanTemplate,
} from './pipeline.state.ts'

/** Worker 调度配置；与 HTTP 进程共用集中配置。 */
export interface PipelineSchedulerConfig {
  leaseTtlSeconds: number
  heartbeatTimeoutSeconds: number
}

/** 日志输出函数；由入口注入，避免模块直接写 process.stdout。 */
export type PipelineSchedulerLogger = (
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>,
) => void

/** Worker 调度依赖。 */
export interface PipelineSchedulerDeps {
  db: Database
  config: PipelineSchedulerConfig
  log: PipelineSchedulerLogger
  /** 运行进入终态后的回调；用于回填依赖运行结果的业务记录。 */
  onRunFinalized?: (runId: string) => Promise<void>
}

/** 单次调度周期统计；用于 Worker 日志与排障。 */
export interface PipelineSchedulerCycleResult {
  offlineNodes: number
  interruptedRuns: number
  expiredLeases: number
  timedOutRuns: number
  scheduledRuns: number
}

const QUEUED_BATCH_SIZE = 20
const MONITOR_BATCH_SIZE = 100
const NODE_UNAVAILABLE_STATUSES = ['offline', 'disabled'] as const

/**
 * 创建流水线调度 Worker。
 * @param deps 数据库、租约/心跳配置与日志函数。
 * @returns 可周期调用的调度周期与关闭函数。
 * @remarks 调度只分配运行并维护租约/超时/离线收口，不派发凭据；
 * 运行计划物化与 Git 凭据签发发生在 Agent 领取租约的 HTTP 请求内。
 */
export function createPipelineScheduler(deps: PipelineSchedulerDeps) {
  const { db, config, log } = deps

  /** 将运行收口为终态；只允许一次条件更新成功，失败说明已被其他路径收口。 */
  async function finishRun(
    runId: string,
    status: 'failed' | 'cancelled' | 'interrupted',
    errorCode: string,
    errorMessage: string,
  ): Promise<boolean> {
    const run = await findPipelineRunById(db, runId)
    if (!run || isTerminalRunStatus(run.status)) return false
    const updated = await updatePipelineRunStatus(db, runId, [run.status], {
      status,
      errorCode,
      errorMessage,
      finishedAt: new Date(),
    })
    if (!updated) return false
    await skipPendingPipelineRunSteps(db, runId)
    await deps.onRunFinalized?.(runId).catch(() => undefined)
    return true
  }

  /** 释放节点上的活动租约并中断对应运行；节点失联或停用时调用。 */
  async function interruptNodeRuns(nodeId: string, reason: string): Promise<number> {
    let count = 0
    const leases = await findActiveLeasesWithRunStatusByNode(db, nodeId)
    for (const lease of leases) {
      const released = await updatePipelineLeaseStatus(db, lease.id, ['active'], { status: 'expired' })
      if (!released) continue
      if (await finishRun(lease.run_id, 'interrupted', 'NODE_OFFLINE', reason)) count += 1
    }
    const runs = await findRunsForNodeWithoutLease(db, nodeId, ['assigned', 'running', 'cancelling'])
    for (const run of runs) {
      if (await finishRun(run.id, 'interrupted', 'NODE_OFFLINE', reason)) count += 1
    }
    return count
  }

  /** 心跳超时的在线节点置离线，并中断其运行。 */
  async function handleStaleNodes(): Promise<{ offlineNodes: number; interruptedRuns: number }> {
    const cutoff = new Date(Date.now() - config.heartbeatTimeoutSeconds * 1000)
    const stale = await markStalePipelineNodesOffline(db, cutoff)
    let interruptedRuns = 0
    for (const node of stale) {
      interruptedRuns += await interruptNodeRuns(node.id, '执行节点心跳超时，运行已中断')
    }
    return { offlineNodes: stale.length, interruptedRuns }
  }

  /** 处理已被管理员停用节点的残留运行。 */
  async function handleUnavailableNodes(): Promise<number> {
    const nodes = await findPipelineNodesByStatuses(db, [...NODE_UNAVAILABLE_STATUSES])
    let interruptedRuns = 0
    for (const node of nodes) {
      interruptedRuns += await interruptNodeRuns(node.id, '执行节点不可用，运行已中断')
    }
    return interruptedRuns
  }

  /** 租约过期不自动改派：中断运行并保留日志与产物。 */
  async function handleExpiredLeases(): Promise<number> {
    const leases = await findExpiredPipelineLeases(db, new Date())
    let expiredLeases = 0
    for (const lease of leases) {
      const updated = await updatePipelineLeaseStatus(db, lease.id, ['active'], { status: 'expired' })
      if (!updated) continue
      expiredLeases += 1
      await finishRun(lease.run_id, 'interrupted', 'LEASE_EXPIRED', '节点租约过期，运行已中断')
    }
    return expiredLeases
  }

  /** 运行级超时：排队超时直接失败；执行超时下发取消并等待 Agent 确认。 */
  async function handleRunTimeouts(): Promise<number> {
    const now = Date.now()
    let timedOut = 0
    const queued = await findPipelineRunsByStatuses(db, ['queued'], MONITOR_BATCH_SIZE)
    for (const run of queued) {
      const deadline = run.created_at.getTime() + run.timeout_seconds * 1000
      if (deadline > now) continue
      if (await finishRun(run.id, 'failed', 'NODE_WAIT_TIMEOUT', '等待执行节点超时，运行已失败')) timedOut += 1
    }
    const active = await findPipelineRunsByStatuses(db, ['assigned', 'running'], MONITOR_BATCH_SIZE, 'started')
    for (const run of active) {
      const startedAt = run.started_at ?? run.assigned_at ?? run.created_at
      if (startedAt.getTime() + run.timeout_seconds * 1000 > now) continue
      const updated = await updatePipelineRunStatus(db, run.id, [run.status], {
        status: 'cancelling',
        cancelRequestedAt: new Date(),
        errorCode: 'RUN_TIMEOUT',
        errorMessage: '运行超过超时时间，已请求停止执行',
      })
      if (!updated) continue
      timedOut += 1
    }
    return timedOut
  }

  /** Worker 侧的取消兜底：取消中的运行没有活动租约时直接收口，避免永久悬挂。 */
  async function handleCancellingWithoutLease(): Promise<number> {
    const running = await findPipelineRunsByStatuses(db, ['cancelling'], MONITOR_BATCH_SIZE, 'started')
    let finished = 0
    for (const run of running) {
      const leases = await findActiveLeasesWithRunStatusByNode(db, run.node_id ?? '')
      const hasLease = leases.some((lease) => lease.run_id === run.id)
      if (hasLease) continue
      const target = run.error_code === 'RUN_TIMEOUT' ? 'failed' : 'cancelled'
      if (await finishRun(run.id, target, run.error_code ?? 'CANCELLED', run.error_message ?? '运行已取消')) {
        finished += 1
      }
    }
    return finished
  }

  /** 为排队运行匹配在线节点并预分配；租约仍由 Agent 领取时创建。 */
  async function scheduleQueuedRuns(): Promise<number> {
    const queued = await findPipelineRunsByStatuses(db, ['queued'], QUEUED_BATCH_SIZE)
    if (queued.length === 0) return 0
    const nodes = await findOnlinePipelineNodes(db)
    if (nodes.length === 0) return 0
    // 容量按“在途运行”统计（assigned/running/cancelling），而不是只统计活动租约：
    // 租约由 Agent 领取时才创建，仅看租约会把同一节点重复超配。
    const inFlight = await countInFlightRunsByNodeIds(
      db,
      nodes.map((node) => node.id),
    )
    const capacity = new Map(inFlight.map((item) => [item.nodeId, Number(item.total)]))
    let scheduled = 0
    for (const run of queued) {
      const full = await findPipelineRunWithPlan(db, run.id)
      if (!full || full.status !== 'queued') continue
      let requirements: string[]
      try {
        requirements = collectRunRequirements(parseRunPlanTemplate(full.run_plan))
      } catch (error) {
        log('error', '运行计划快照不合法，跳过调度', { runId: run.id })
        void error
        continue
      }
      const node = nodes.find((candidate) => {
        const used = capacity.get(candidate.id) ?? 0
        return used < candidate.concurrency_limit && nodeSatisfiesRequirements(candidate.capabilities, requirements)
      })
      if (!node) continue
      // 事务内锁定节点行后再判断容量，避免多个 Worker 并发周期各自读到旧容量而超配。
      const assigned = await db.transaction(async (tx) => {
        const locked = await lockPipelineNode(tx, node.id)
        if (!locked || locked.status !== 'online' || locked.disabled_at !== null) return undefined
        const inFlightNow = await countInFlightRunsForNode(tx, node.id)
        if (inFlightNow >= locked.concurrency_limit) return undefined
        return claimQueuedPipelineRun(tx, run.id, node.id, new Date())
      })
      if (!assigned) continue
      capacity.set(node.id, (capacity.get(node.id) ?? 0) + 1)
      scheduled += 1
    }
    return scheduled
  }

  /** 执行一次完整调度周期；周期内任一阶段失败会记录日志并继续后续阶段。 */
  async function runCycle(): Promise<PipelineSchedulerCycleResult> {
    const stale = await handleStaleNodes()
    const unavailableInterrupted = await handleUnavailableNodes()
    const expiredLeases = await handleExpiredLeases()
    const timedOutRuns = await handleRunTimeouts()
    const cancelledWithoutLease = await handleCancellingWithoutLease()
    const scheduledRuns = await scheduleQueuedRuns()
    const result: PipelineSchedulerCycleResult = {
      offlineNodes: stale.offlineNodes,
      interruptedRuns: stale.interruptedRuns + unavailableInterrupted,
      expiredLeases,
      timedOutRuns: timedOutRuns + cancelledWithoutLease,
      scheduledRuns,
    }
    if (
      result.offlineNodes > 0 ||
      result.interruptedRuns > 0 ||
      result.expiredLeases > 0 ||
      result.timedOutRuns > 0 ||
      result.scheduledRuns > 0
    ) {
      log('info', '流水线调度周期完成', { ...result })
    }
    return result
  }

  return { runCycle }
}
