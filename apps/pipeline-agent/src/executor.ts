import { posix } from 'node:path'

import type {
  AgentStepStatusRequest,
  PipelineStepStatus,
  RunPlan,
  RunPlanJob,
  RunPlanStep,
} from '@dev-ops/pipeline-protocol'

import { ArtifactError, packArtifact, removePackedArtifact, validateArtifactName } from './artifacts.ts'
import { AsyncAbortError, AsyncTimeoutError, withDeadline } from './async.ts'
import { CONTAINER_WORKSPACE_DIR } from './docker.ts'
import type { DockerRuntime, JobContainer } from './docker.ts'
import { describeError, isLeaseLostError } from './errors.ts'
import type { LogCollector } from './logs.ts'
import type { AgentLogger } from './logger.ts'
import type { SecretMasker } from './masking.ts'
import { createRunWorkspace } from './workspace.ts'
import type { RunWorkspace, RunWorkspaceOptions } from './workspace.ts'

/** 运行停止原因；取消与中断必须区分，且都不能上报成功。 */
export type RunStopReason = 'cancelled' | 'interrupted'

/** 可外部触发的运行停止信号；首次原因生效，后续调用忽略。 */
export interface RunStopSignal {
  readonly signal: AbortSignal
  readonly reason: RunStopReason | null
  stop(reason: RunStopReason): void
}

/**
 * 创建运行停止信号。
 * @returns 取消信号、停止原因与停止方法；用于平台取消、租约失效与节点退出。
 */
export function createRunStopSignal(): RunStopSignal {
  const controller = new AbortController()
  let reason: RunStopReason | null = null
  return {
    signal: controller.signal,
    get reason(): RunStopReason | null {
      return reason
    },
    stop(next: RunStopReason): void {
      if (reason) return
      reason = next
      controller.abort()
    },
  }
}

/** 产物上传输入；filePath 指向本地打包后的 tar 文件。 */
export interface ArtifactUploadRequest {
  stepIndex: number
  name: string
  sha256: string
  sizeBytes: number
  filePath: string
}

/** 执行器向平台上报状态与产物的接口；租约失效时由实现抛出业务错误。 */
export interface RunReportSink {
  reportStepStatus(stepIndex: number, body: AgentStepStatusRequest): Promise<void>
  uploadArtifact(input: ArtifactUploadRequest): Promise<void>
}

export interface ExecuteRunPlanOptions {
  plan: RunPlan
  /** Agent 工作根目录；执行器在其中创建本次运行的隔离工作区。 */
  workDir: string
  docker: DockerRuntime
  sink: RunReportSink
  collector: LogCollector
  masker: SecretMasker
  logger: AgentLogger
  stop: RunStopSignal
  /** 单个产物大小上限，单位字节。 */
  artifactMaxBytes: number
  /** 运行开始时间戳；缺省取当前时间，用于运行级超时。 */
  startedAt?: number
  /** 工作区创建函数；缺省使用真实实现，测试可替换以验证超时分类。 */
  createWorkspace?: (options: RunWorkspaceOptions) => Promise<RunWorkspace>
}

/** 运行执行结果；status 只允许四种终态，不把失败/中断写成成功。 */
export interface RunExecutionResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  errorCode?: string
  errorMessage?: string
  /** 清理失败的资源描述；非空时必须随完成上报给平台。 */
  cleanupFailures: string[]
}

/** 单步执行结果；canContinue 表示失败后是否允许继续执行后续步骤。 */
interface StepResult {
  status: PipelineStepStatus
  exitCode: number | null
  errorCode: string | null
  errorMessage: string | null
  canContinue: boolean
}

/** 租约失效的内部信号；由上报层转换为 interrupted，不再尝试写平台。 */
class LeaseGoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LeaseGoneError'
  }
}

/** 步骤参数不合法；平台校验过运行计划时不应出现，Agent 仍显式失败而不是猜测。 */
class StepOptionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StepOptionError'
    this.code = code
  }
}

/** 错误摘要最大长度，需小于协议 errorMessage 上限 4000。 */
const MAX_ERROR_MESSAGE_CHARS = 1_500
/** 环境变量名规则；由 workflow 校验保证，这里做防御性检查。 */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function remainingMs(deadlineAt: number): number {
  return deadlineAt - Date.now()
}

function truncateMessage(masker: SecretMasker, message: string): string {
  return masker.maskText(message).slice(0, MAX_ERROR_MESSAGE_CHARS)
}

function failure(
  step: RunPlanStep,
  errorCode: string,
  errorMessage: string,
  exitCode: number | null = null,
): StepResult {
  return {
    status: 'failed',
    exitCode,
    errorCode,
    errorMessage,
    canContinue: step.continueOnError === true,
  }
}

function cancelledResult(exitCode: number | null): StepResult {
  return { status: 'cancelled', exitCode, errorCode: null, errorMessage: null, canContinue: false }
}

function toStatusRequest(result: StepResult): AgentStepStatusRequest {
  return {
    status: result.status,
    exitCode: result.exitCode,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  }
}

/** 合并运行/ job /步骤环境变量；步骤级覆盖 job 与运行级。 */
function mergeEnvironment(plan: RunPlan, job: RunPlanJob, step: RunPlanStep): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const source of [plan.env, job.env, step.env]) {
    if (!source) continue
    for (const [name, value] of Object.entries(source)) {
      if (!ENV_NAME_PATTERN.test(name)) throw new StepOptionError('INVALID_STEP_ENV', `环境变量名不合法：${name}`)
      if (value.includes('\0')) throw new StepOptionError('INVALID_STEP_ENV', `环境变量 ${name} 包含空字符`)
      merged[name] = value
    }
  }
  return merged
}

/** 把 workflow 的相对工作目录映射为容器内绝对路径，并阻止逃逸工作区。 */
function resolveContainerWorkingDirectory(relativeWorkingDirectory: string | undefined): string {
  const relative = relativeWorkingDirectory ?? '.'
  if (posix.isAbsolute(relative)) throw new StepOptionError('INVALID_WORKING_DIRECTORY', '步骤工作目录不能是绝对路径')
  const resolved = posix.resolve(CONTAINER_WORKSPACE_DIR, relative)
  if (resolved !== CONTAINER_WORKSPACE_DIR && !resolved.startsWith(`${CONTAINER_WORKSPACE_DIR}/`)) {
    throw new StepOptionError('INVALID_WORKING_DIRECTORY', '步骤工作目录不能逃逸工作区')
  }
  return resolved
}

/** 运行级超时统一结果；超时终止容器/中断检出后不再执行后续步骤。 */
function timeoutFailure(message: string): StepResult {
  return { status: 'failed', exitCode: null, errorCode: 'RUN_TIMEOUT', errorMessage: message, canContinue: false }
}

/**
 * 判断步骤失败是否由运行级截止时间引起。
 * @param deadlineAt 运行截止时间戳。
 * @param error 可选异常；AsyncTimeoutError/AsyncAbortError 表示等待被截止或取消。
 * @returns 已超过截止时间或异常来自超时/取消时为真；随后应按 RUN_TIMEOUT 收口。
 */
function isDeadlineExceeded(deadlineAt: number, error?: unknown): boolean {
  if (remainingMs(deadlineAt) <= 0) return true
  return error instanceof AsyncTimeoutError || error instanceof AsyncAbortError
}

/** 上报步骤状态；租约失效转换为 LeaseGoneError，其他错误向上抛出。 */
async function reportStatus(sink: RunReportSink, stepIndex: number, body: AgentStepStatusRequest): Promise<void> {
  try {
    await sink.reportStepStatus(stepIndex, body)
  } catch (error) {
    if (isLeaseLostError(error)) throw new LeaseGoneError('租约已失效，停止步骤状态上报')
    throw error
  }
}

interface StepContext {
  plan: RunPlan
  job: RunPlanJob
  step: RunPlanStep
  container: JobContainer
  workspace: RunWorkspace
  sink: RunReportSink
  collector: LogCollector
  masker: SecretMasker
  logger: AgentLogger
  stop: RunStopSignal
  deadlineAt: number
  artifactMaxBytes: number
}

/** 执行 builtin_checkout：在宿主侧用短期凭据检出固定提交。 */
async function executeCheckoutStep(context: StepContext): Promise<StepResult> {
  const fetchDepth = context.step.with?.['fetch-depth']
  if (fetchDepth !== undefined && fetchDepth !== '1') {
    return failure(context.step, 'UNSUPPORTED_STEP_OPTION', `不支持的 fetch-depth：${fetchDepth}`)
  }
  if (context.stop.reason) return cancelledResult(null)
  if (remainingMs(context.deadlineAt) <= 0) return timeoutFailure('运行超过运行级超时')
  context.collector.append(context.step.index, `检出提交 ${context.plan.git.commitSha}\n`)
  try {
    await context.workspace.ensureCheckout(context.plan.git, remainingMs(context.deadlineAt))
  } catch (error) {
    if (context.stop.reason) return cancelledResult(null)
    // 运行截止或检出等待被超时中断时属于运行级超时，不能误报成 Git 失败。
    if (isDeadlineExceeded(context.deadlineAt, error)) return timeoutFailure('运行超过运行级超时，代码检出被中断')
    return failure(context.step, 'GIT_CHECKOUT_FAILED', truncateMessage(context.masker, describeError(error)))
  }
  if (isDeadlineExceeded(context.deadlineAt)) return timeoutFailure('运行超过运行级超时，代码检出完成后无剩余时间')
  context.collector.append(context.step.index, `已检出提交 ${context.workspace.checkedOutCommit?.slice(0, 12) ?? ''}\n`)
  return { status: 'succeeded', exitCode: null, errorCode: null, errorMessage: null, canContinue: true }
}

/** 执行 builtin_upload_artifact：打包、计算校验和并流式上传。 */
async function executeArtifactStep(context: StepContext): Promise<StepResult> {
  const name = context.step.with?.name
  const artifactPath = context.step.with?.path
  if (!name || !artifactPath) return failure(context.step, 'INVALID_STEP_OPTION', '产物步骤缺少 name 或 path')
  try {
    validateArtifactName(name)
  } catch (error) {
    const code = error instanceof ArtifactError ? error.code : 'ARTIFACT_NAME_INVALID'
    return failure(context.step, code, truncateMessage(context.masker, describeError(error)))
  }
  if (context.stop.reason) return cancelledResult(null)
  if (remainingMs(context.deadlineAt) <= 0) return timeoutFailure('运行超过运行级超时')
  context.collector.append(context.step.index, `打包产物 ${name}：${artifactPath}\n`)
  let packed
  try {
    packed = await packArtifact({
      workspaceDir: context.workspace.checkoutDir,
      artifactPath,
      tempDir: context.workspace.tempDir,
      maxBytes: context.artifactMaxBytes,
      logger: context.logger,
    })
  } catch (error) {
    if (context.stop.reason) return cancelledResult(null)
    if (isDeadlineExceeded(context.deadlineAt, error)) return timeoutFailure('运行超过运行级超时，产物打包被中断')
    if (error instanceof ArtifactError) return failure(context.step, error.code, error.message)
    return failure(context.step, 'ARTIFACT_PACK_FAILED', truncateMessage(context.masker, describeError(error)))
  }
  if (isDeadlineExceeded(context.deadlineAt)) {
    await removePackedArtifact(packed)
    return timeoutFailure('运行超过运行级超时，产物打包完成后无剩余时间')
  }
  try {
    await withDeadline(
      context.sink.uploadArtifact({
        stepIndex: context.step.index,
        name,
        sha256: packed.sha256,
        sizeBytes: packed.sizeBytes,
        filePath: packed.filePath,
      }),
      { timeoutMs: Math.max(1, remainingMs(context.deadlineAt)), label: '产物上传' },
    )
  } catch (error) {
    if (isLeaseLostError(error)) throw new LeaseGoneError('租约已失效，停止产物上传')
    if (context.stop.reason) return cancelledResult(null)
    if (error instanceof AsyncTimeoutError || error instanceof AsyncAbortError) {
      return timeoutFailure(error.message)
    }
    const code = errorCodeOf(error) ?? 'ARTIFACT_UPLOAD_FAILED'
    return failure(context.step, code, truncateMessage(context.masker, describeError(error)))
  } finally {
    await removePackedArtifact(packed)
  }
  context.collector.append(
    context.step.index,
    `产物已上传：${name}（${packed.sizeBytes} 字节，sha256=${packed.sha256}）\n`,
  )
  return { status: 'succeeded', exitCode: null, errorCode: null, errorMessage: null, canContinue: true }
}

/** 执行 run 步骤：在容器内以 sh -c 执行平台固定命令。 */
async function executeCommandStep(context: StepContext): Promise<StepResult> {
  const script = context.step.run
  if (!script) return failure(context.step, 'INVALID_STEP_OPTION', 'run 步骤缺少命令')
  if (context.stop.reason) return cancelledResult(null)
  const remaining = remainingMs(context.deadlineAt)
  if (remaining <= 0) return timeoutFailure('运行超过运行级超时')
  let workingDirectory: string
  let env: Record<string, string>
  try {
    workingDirectory = resolveContainerWorkingDirectory(context.step.workingDirectory)
    env = mergeEnvironment(context.plan, context.job, context.step)
  } catch (error) {
    if (error instanceof StepOptionError) return failure(context.step, error.code, error.message)
    return failure(context.step, 'INVALID_STEP_OPTION', truncateMessage(context.masker, describeError(error)))
  }
  const stepTimeoutMs = context.step.timeoutSeconds !== undefined ? context.step.timeoutSeconds * 1_000 : remaining
  const timeoutMs = Math.min(stepTimeoutMs, remaining)
  context.collector.append(context.step.index, `开始步骤：${context.step.name}\n`)
  let result
  try {
    result = await context.container.exec({
      script,
      env,
      workingDirectory,
      timeoutMs,
      signal: context.stop.signal,
      onOutput: (text: string) => context.collector.append(context.step.index, text),
    })
  } catch (error) {
    if (context.stop.reason) return cancelledResult(null)
    return failure(context.step, 'COMMAND_START_FAILED', truncateMessage(context.masker, describeError(error)))
  }
  if (result.cancelled) return cancelledResult(null)
  if (result.timedOut) {
    const runTimedOut = remainingMs(context.deadlineAt) <= 0
    return {
      status: 'failed',
      exitCode: null,
      errorCode: runTimedOut ? 'RUN_TIMEOUT' : 'STEP_TIMEOUT',
      errorMessage: runTimedOut ? '运行超过运行级超时，容器已终止' : '步骤超过步骤级超时，容器已终止',
      canContinue: false,
    }
  }
  if (result.exitCode !== 0) {
    return failure(context.step, 'COMMAND_FAILED', `命令退出码 ${String(result.exitCode)}`, result.exitCode)
  }
  return { status: 'succeeded', exitCode: result.exitCode, errorCode: null, errorMessage: null, canContinue: true }
}

async function executeStep(context: StepContext): Promise<StepResult> {
  switch (context.step.kind) {
    case 'builtin_checkout':
      return executeCheckoutStep(context)
    case 'builtin_upload_artifact':
      return executeArtifactStep(context)
    case 'run':
      return executeCommandStep(context)
  }
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

async function removeContainer(container: JobContainer, logger: AgentLogger): Promise<string | undefined> {
  try {
    await container.remove()
    return undefined
  } catch (error) {
    const detail = `删除容器 ${container.id} 失败：${describeError(error)}`
    logger.warn(detail)
    return detail
  }
}

/** 把未执行步骤标记为 skipped；租约失效或网络失败时停止尝试。 */
async function reportSkippedSteps(
  sink: RunReportSink,
  steps: readonly RunPlanStep[],
  reported: Map<number, PipelineStepStatus>,
  logger: AgentLogger,
): Promise<void> {
  for (const step of steps) {
    if (reported.has(step.index)) continue
    try {
      await sink.reportStepStatus(step.index, { status: 'skipped' })
      reported.set(step.index, 'skipped')
    } catch (error) {
      logger.warn(`上报步骤 ${step.index} 为 skipped 失败：${describeError(error)}`)
      return
    }
  }
}

/**
 * 在隔离工作区与单容器内串行执行平台固定的运行计划。
 * @param options 运行计划、Docker 运行时、上报接口、日志收集器、停止信号与大小上限。
 * @returns 终态结果与清理失败清单；清理失败不改变步骤事实，但必须随完成上报。
 * @remarks
 * - 运行级超时优先于步骤级超时；超时或取消都会终止当前容器。
 * - 步骤超时会终止容器，因此即使 continue-on-error 为真也不再执行同一 job 的后续步骤。
 * - 无论成功、失败、取消还是异常，finally 都会删除容器与工作区并 flush 日志。
 */
export async function executeRunPlan(options: ExecuteRunPlanOptions): Promise<RunExecutionResult> {
  const { plan, sink, stop, collector, masker, logger } = options
  const startedAt = options.startedAt ?? Date.now()
  const deadlineAt = startedAt + plan.timeoutSeconds * 1_000
  masker.addSecrets([...Object.values(plan.secrets), plan.git.password])
  const allSteps = plan.jobs.flatMap((job) => job.steps)
  const reported = new Map<number, PipelineStepStatus>()
  const cleanupFailures: string[] = []
  let result: RunExecutionResult = { status: 'succeeded', cleanupFailures }
  let workspace: RunWorkspace | undefined
  let container: JobContainer | undefined

  try {
    const workspaceFactory = options.createWorkspace ?? createRunWorkspace
    const runWorkspace = await workspaceFactory({
      workDir: options.workDir,
      runId: plan.runId,
      logger,
      masker,
    })
    workspace = runWorkspace
    for (const job of plan.jobs) {
      if (stop.reason) {
        result = { status: stop.reason, cleanupFailures }
        break
      }
      const jobContainer = await withDeadline(
        options.docker.ensureImage(job.image).then(() =>
          options.docker.createJobContainer({
            image: job.image,
            runId: plan.runId,
            jobId: job.id,
            workspaceDir: runWorkspace.checkoutDir,
          }),
        ),
        { timeoutMs: Math.max(1, remainingMs(deadlineAt)), signal: stop.signal, label: '准备任务容器' },
      )
      container = jobContainer
      let jobFinished = false
      for (const step of job.steps) {
        if (stop.reason) {
          result = { status: stop.reason, cleanupFailures }
          jobFinished = true
          break
        }
        const stepRemaining = remainingMs(deadlineAt)
        if (stepRemaining <= 0) {
          const timeoutResult = timeoutFailure('运行超过运行级超时')
          reported.set(step.index, 'failed')
          await reportStatus(sink, step.index, toStatusRequest(timeoutResult))
          result = {
            status: 'failed',
            errorCode: 'RUN_TIMEOUT',
            errorMessage: timeoutResult.errorMessage ?? undefined,
            cleanupFailures,
          }
          jobFinished = true
          break
        }
        await reportStatus(sink, step.index, { status: 'running' })
        reported.set(step.index, 'running')
        const executed = await executeStep({
          plan,
          job,
          step,
          container: jobContainer,
          workspace: runWorkspace,
          sink,
          collector,
          masker,
          logger,
          stop,
          deadlineAt,
          artifactMaxBytes: options.artifactMaxBytes,
        })
        // 运行级超时优先：即使步骤本身成功返回，超过运行截止也按 RUN_TIMEOUT 收口。
        const stepResult =
          executed.status === 'succeeded' && isDeadlineExceeded(deadlineAt)
            ? timeoutFailure('运行超过运行级超时')
            : executed
        reported.set(step.index, stepResult.status)
        await reportStatus(sink, step.index, toStatusRequest(stepResult))
        if (stepResult.status === 'cancelled') {
          result = { status: stop.reason ?? 'cancelled', cleanupFailures }
          jobFinished = true
          break
        }
        if (stepResult.status === 'failed' && !stepResult.canContinue) {
          result = {
            status: 'failed',
            ...(stepResult.errorCode ? { errorCode: stepResult.errorCode } : {}),
            ...(stepResult.errorMessage ? { errorMessage: stepResult.errorMessage } : {}),
            cleanupFailures,
          }
          jobFinished = true
          break
        }
      }
      if (container) {
        const failureDetail = await removeContainer(container, logger)
        if (failureDetail) cleanupFailures.push(failureDetail)
        container = undefined
      }
      if (jobFinished) break
    }
  } catch (error) {
    if (error instanceof LeaseGoneError) {
      result = {
        status: 'interrupted',
        errorCode: 'AGENT_LEASE_EXPIRED',
        errorMessage: '租约已失效，停止本地执行并清理',
        cleanupFailures,
      }
    } else if (error instanceof AsyncAbortError) {
      result = { status: stop.reason ?? 'interrupted', cleanupFailures }
    } else if (error instanceof AsyncTimeoutError) {
      result = { status: 'failed', errorCode: 'RUN_TIMEOUT', errorMessage: error.message, cleanupFailures }
    } else {
      result = {
        status: 'failed',
        errorCode: errorCodeOf(error) ?? 'AGENT_EXECUTION_FAILED',
        errorMessage: truncateMessage(masker, describeError(error)),
        cleanupFailures,
      }
    }
  } finally {
    if (container) {
      const failureDetail = await removeContainer(container, logger)
      if (failureDetail) cleanupFailures.push(failureDetail)
    }
    if (workspace) {
      try {
        await workspace.remove()
      } catch (error) {
        const detail = `删除运行工作区失败：${describeError(error)}`
        logger.warn(detail)
        cleanupFailures.push(detail)
      }
    }
    try {
      await collector.flush()
    } catch (error) {
      logger.warn(`刷新日志失败：${describeError(error)}`)
    }
  }

  // 未执行步骤按 skipped 收口；若租约已失效，这里会静默停止，由平台按租约过期处理。
  if (!stop.reason) await reportSkippedSteps(sink, allSteps, reported, logger)
  if (cleanupFailures.length > 0 && result.status === 'succeeded') {
    result = {
      ...result,
      errorCode: 'AGENT_CLEANUP_FAILED',
      errorMessage: truncateMessage(masker, `运行结束但资源清理失败：${cleanupFailures.join('；')}`),
    }
  }
  return result
}
