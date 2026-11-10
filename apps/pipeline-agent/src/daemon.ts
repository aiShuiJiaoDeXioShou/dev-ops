import type { AgentCompleteRequest, PipelineLease } from '@dev-ops/pipeline-protocol'

import type { AgentClient } from './agent.ts'
import { createAgentClient } from './agent.ts'
import { AGENT_VERSION } from './version.ts'
import { createPlatformHttp } from './client.ts'
import type { AgentConfig } from './config.ts'
import { createDockerRuntime } from './docker.ts'
import type { DockerRuntime } from './docker.ts'
import { classifyFatalError, describeError, isLeaseLostError } from './errors.ts'
import { createRunStopSignal, executeRunPlan } from './executor.ts'
import type { RunExecutionResult, RunReportSink, RunStopReason, RunStopSignal } from './executor.ts'
import { createLogCollector } from './logs.ts'
import type { AgentLogger } from './logger.ts'
import { createAgentLogger } from './logger.ts'
import { createSecretMasker } from './masking.ts'
import { cleanupStaleRunWorkspaces } from './workspace.ts'
import { sleep } from './async.ts'

/** 租约续约间隔上限；协议建议 30 秒，TTL 较短时按 1/3 推导。 */
const MAX_RENEW_INTERVAL_MS = 30_000
/** 续约间隔下限，避免对平台造成过高压力。 */
const MIN_RENEW_INTERVAL_MS = 5_000
/** 领取租约失败或节点被限制领取时的退避，避免忙轮询。 */
const CLAIM_RETRY_DELAY_MS = 2_000

export interface AgentDaemonOptions {
  config: AgentConfig
  /** 外部退出信号；收到后停止领取，并按 interrupted 收口当前租约。 */
  signal: AbortSignal
  /** 日志输出函数；默认写 stderr。脱敏器由 daemon 内部创建并共享给日志与客户端。 */
  writeLog?: (line: string) => void
  /** 注入的协议客户端与 Docker 运行时；缺省按配置创建。测试可替换。 */
  client?: AgentClient
  docker?: DockerRuntime
}

/** 正在执行的租约与停止控制。 */
interface ActiveRun {
  readonly lease: PipelineLease
  readonly stop: RunStopSignal
  /** 租约已失效时禁止再上报（包括完成）；由续约/上报错误置位。 */
  readonly leaseLost: boolean
  /** 请求停止执行；首次原因生效。 */
  requestStop(reason: RunStopReason, options?: { leaseLost?: boolean }): void
  /** 标记租约失效；用于任何租约作用域请求返回过期/无效时停止后续写入。 */
  markLeaseLost(): void
}

function createActiveRun(lease: PipelineLease): ActiveRun {
  const stop = createRunStopSignal()
  let leaseLost = false
  return {
    lease,
    stop,
    get leaseLost(): boolean {
      return leaseLost
    },
    requestStop(reason: RunStopReason, options?: { leaseLost?: boolean }): void {
      if (options?.leaseLost === true) leaseLost = true
      stop.stop(reason)
    },
    markLeaseLost(): void {
      leaseLost = true
    },
  }
}

/** 由租约 TTL 推导续约间隔；取 TTL 的 1/3 并限制在 5–30 秒。 */
function renewIntervalMs(leaseTtlSeconds: number): number {
  const derived = Math.floor((leaseTtlSeconds * 1_000) / 3)
  return Math.min(MAX_RENEW_INTERVAL_MS, Math.max(MIN_RENEW_INTERVAL_MS, derived))
}

/**
 * 启动 Agent 长驻循环：注册、心跳、租约轮询、执行、续约与退出收口。
 * @param options 配置、外部退出信号、可注入的客户端/Docker 与日志输出。
 * @returns 收到退出信号或遇到令牌/版本等终止性错误后结束。
 * @throws 令牌失效、节点停用等终止性错误会以异常结束，由入口设为非零退出码。
 * @remarks
 * - 心跳与续约分别定时；取消下发（心跳 cancelLeaseIds 或续约 cancelRequested）会立即中止执行。
 * - 租约失效时不再写平台，避免覆盖平台已收口的状态。
 * - 退出信号触发时当前租约按 interrupted 上报（尽力而为），不等待平台取消确认。
 */
export async function runAgentDaemon(options: AgentDaemonOptions): Promise<void> {
  const { config } = options
  const masker = createSecretMasker()
  const logger: AgentLogger = createAgentLogger({
    masker,
    ...(options.writeLog ? { write: options.writeLog } : {}),
  })
  const http = createPlatformHttp({
    baseUrl: config.platformUrl,
    timeoutMs: config.controlTimeoutMs,
    logger,
  })
  const client =
    options.client ??
    createAgentClient({
      http,
      logger,
      masker,
      nodeName: config.nodeName,
      capabilities: config.labels,
      ...(config.registrationToken ? { registrationToken: config.registrationToken } : {}),
      ...(config.agentToken ? { agentToken: config.agentToken } : {}),
      artifactUploadTimeoutMs: config.artifactUploadTimeoutMs,
    })
  const docker =
    options.docker ??
    createDockerRuntime({
      ...(config.dockerSocketPath ? { socketPath: config.dockerSocketPath } : {}),
      limits: config.container,
      ...(config.containerUser ? { containerUser: config.containerUser } : {}),
      logger,
    })

  await docker.ping()
  await cleanupStaleRunWorkspaces(config.workDir, logger)
  const session = await client.ensureRegistered()
  logger.info(`节点 ${config.nodeName} 已启动：agent ${AGENT_VERSION}，标签 ${config.labels.join(',')}`)

  const internalStop = new AbortController()
  let heartbeatIntervalMs = session.heartbeatIntervalSeconds * 1_000
  const renewInterval = renewIntervalMs(session.leaseTtlSeconds)
  let activeRun: ActiveRun | undefined
  let claimEnabled = true
  let fatalError: Error | undefined

  const onExternalAbort = (): void => {
    logger.info('收到退出信号，停止领取并中断当前租约')
    internalStop.abort()
    activeRun?.requestStop('interrupted')
  }
  if (options.signal.aborted) onExternalAbort()
  else options.signal.addEventListener('abort', onExternalAbort, { once: true })

  function handleFatal(error: unknown): boolean {
    const fatal = classifyFatalError(error)
    if (fatal === 'exit') {
      fatalError = error instanceof Error ? error : new Error(describeError(error))
      logger.error(`Agent 终止：${describeError(error)}`)
      internalStop.abort()
      return true
    }
    if (fatal === 'stop-claiming') {
      claimEnabled = false
      logger.warn(`节点被停用或令牌失效，停止领取新任务：${describeError(error)}`)
      return true
    }
    return false
  }

  async function heartbeatLoop(): Promise<void> {
    while (!internalStop.signal.aborted) {
      const leaseId = activeRun?.lease.leaseId ?? null
      try {
        const heartbeat = await client.heartbeat(leaseId)
        heartbeatIntervalMs = heartbeat.heartbeatIntervalSeconds * 1_000
        if (leaseId && heartbeat.cancelLeaseIds.includes(leaseId)) {
          activeRun?.requestStop('cancelled')
          logger.info(`心跳下发取消：租约 ${leaseId}`)
        }
      } catch (error) {
        if (internalStop.signal.aborted) return
        if (handleFatal(error)) return
        logger.warn(`心跳失败：${describeError(error)}`)
      }
      await sleep(heartbeatIntervalMs, internalStop.signal)
    }
  }

  /** 启动续约循环；返回幂等停止函数，立即中止等待并等待循环退出。 */
  function startRenewLoop(run: ActiveRun): () => Promise<void> {
    const renewAbort = new AbortController()
    const onInternalStop = (): void => renewAbort.abort()
    internalStop.signal.addEventListener('abort', onInternalStop, { once: true })
    const loop = (async (): Promise<void> => {
      while (!renewAbort.signal.aborted) {
        const slept = await sleep(renewInterval, renewAbort.signal)
        if (!slept) return
        try {
          const renewal = await client.renewLease(run.lease)
          if (renewal.cancelRequested) {
            run.requestStop('cancelled')
            logger.info(`续约返回取消：租约 ${run.lease.leaseId}`)
          }
        } catch (error) {
          if (isLeaseLostError(error)) {
            run.requestStop('interrupted', { leaseLost: true })
            logger.warn(`租约已失效，停止本地执行：${describeError(error)}`)
            return
          }
          if (handleFatal(error)) {
            run.requestStop('interrupted', { leaseLost: true })
            return
          }
          logger.warn(`续约失败：${describeError(error)}`)
        }
      }
    })()
    return async (): Promise<void> => {
      internalStop.signal.removeEventListener('abort', onInternalStop)
      renewAbort.abort()
      await loop
    }
  }

  async function reportCompletion(lease: PipelineLease, body: AgentCompleteRequest, leaseLost: boolean): Promise<void> {
    if (leaseLost) {
      logger.warn(`租约已失效，跳过完成上报（${body.status}）`)
      return
    }
    try {
      const response = await client.complete(lease, body)
      logger.info(`运行 ${response.runId} 完成上报：${response.status}`)
    } catch (error) {
      logger.error(`完成上报失败：${describeError(error)}`)
    }
  }

  async function runLease(lease: PipelineLease, run: ActiveRun): Promise<RunExecutionResult> {
    // 任一租约作用域请求返回过期/无效，都标记租约失效：停止后续写入且跳过完成上报。
    const leaseAwareError = (error: unknown): unknown => {
      if (isLeaseLostError(error)) run.markLeaseLost()
      return error
    }
    const collector = createLogCollector({
      masker,
      logger,
      chunkMaxBytes: config.logChunkMaxBytes,
      uploadLogs: async (chunks) => {
        try {
          return await client.uploadLogs(lease, chunks)
        } catch (error) {
          throw leaseAwareError(error)
        }
      },
    })
    const sink: RunReportSink = {
      reportStepStatus: async (stepIndex, body) => {
        try {
          await client.reportStepStatus(lease, stepIndex, body)
        } catch (error) {
          throw leaseAwareError(error)
        }
      },
      uploadArtifact: async (input) => {
        try {
          await client.uploadArtifact(lease, input)
        } catch (error) {
          throw leaseAwareError(error)
        }
      },
    }
    return executeRunPlan({
      plan: lease.run,
      workDir: config.workDir,
      docker,
      sink,
      collector,
      masker,
      logger,
      stop: run.stop,
      artifactMaxBytes: config.artifactMaxBytes,
    })
  }

  async function executeLease(lease: PipelineLease): Promise<void> {
    const run = createActiveRun(lease)
    activeRun = run
    const stopRenew = startRenewLoop(run)
    let execution: RunExecutionResult
    try {
      execution = await runLease(lease, run)
    } finally {
      await stopRenew()
      activeRun = undefined
    }
    await reportCompletion(
      lease,
      {
        status: execution.status,
        errorCode: execution.errorCode ?? null,
        errorMessage: execution.errorMessage ?? null,
      },
      run.leaseLost,
    )
  }

  const heartbeatPromise = heartbeatLoop().catch((error: unknown) => {
    logger.error(`心跳循环异常退出：${describeError(error)}`)
    internalStop.abort()
  })
  try {
    while (!internalStop.signal.aborted && !fatalError) {
      if (!claimEnabled) {
        await sleep(CLAIM_RETRY_DELAY_MS, internalStop.signal)
        continue
      }
      let lease: PipelineLease | null
      try {
        lease = await client.acquireLease(config.pollWaitSeconds)
      } catch (error) {
        if (internalStop.signal.aborted) break
        if (handleFatal(error)) break
        logger.warn(`领取租约失败：${describeError(error)}`)
        await sleep(CLAIM_RETRY_DELAY_MS, internalStop.signal)
        continue
      }
      if (!lease) continue
      await executeLease(lease)
    }
  } finally {
    options.signal.removeEventListener('abort', onExternalAbort)
    internalStop.abort()
    await heartbeatPromise
  }
  if (fatalError) throw fatalError
}
