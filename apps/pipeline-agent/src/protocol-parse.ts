import type {
  AgentArtifactUploadResponse,
  AgentCompleteResponse,
  AgentHeartbeatResponse,
  AgentLeaseRenewResponse,
  AgentLogsResponse,
  AgentRegisterResponse,
  AgentStepStatusResponse,
  PipelineInputs,
  PipelineLease,
  PipelineStepKind,
  PipelineStepStatus,
  RunPlan,
  RunPlanGit,
  RunPlanJob,
  RunPlanStep,
} from '@dev-ops/pipeline-protocol'

import { AgentTransportError } from './errors.ts'

/**
 * 平台响应的结构校验：外部 JSON 一律先按 unknown 处理，逐字段收窄后返回协议类型。
 * 校验失败抛 AgentTransportError，表示响应不符合已登记契约，而不是业务失败。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AgentTransportError(`平台响应字段不合法：${path} 应为对象`)
  return value
}

function expectString(value: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new AgentTransportError(`平台响应字段不合法：${path} 应为长度不超过 ${maxLength} 的字符串`)
  }
  return value
}

function optionalString(value: unknown, path: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return expectString(value, path, maxLength)
}

function expectInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AgentTransportError(`平台响应字段不合法：${path} 应为 ${minimum}–${maximum} 的整数`)
  }
  return value
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AgentTransportError(`平台响应字段不合法：${path} 应为布尔值`)
  return value
}

function expectStringRecord(value: unknown, path: string): Record<string, string> {
  const record = expectRecord(value, path)
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    result[key] = expectString(entry, `${path}.${key}`, 32_768, true)
  }
  return result
}

function expectInputs(value: unknown, path: string): PipelineInputs {
  const record = expectRecord(value, path)
  const result: PipelineInputs = {}
  for (const [key, entry] of Object.entries(record)) {
    const entryPath = `${path}.${key}`
    if (typeof entry === 'string') {
      result[key] = expectString(entry, entryPath, 4_096, true)
    } else if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new AgentTransportError(`平台响应字段不合法：${entryPath} 应为有限数字`)
      result[key] = entry
    } else if (typeof entry === 'boolean') {
      result[key] = entry
    } else {
      throw new AgentTransportError(`平台响应字段不合法：${entryPath} 应为字符串、数字或布尔值`)
    }
  }
  return result
}

function expectStrategyArray(value: unknown, path: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new AgentTransportError(`平台响应字段不合法：${path} 应为 ${minimum}–${maximum} 项数组`)
  }
  return value.map((entry, index) => expectString(entry, `${path}[${index}]`, 500))
}

function expectStepKind(value: unknown, path: string): PipelineStepKind {
  if (value === 'run' || value === 'builtin_checkout' || value === 'builtin_upload_artifact') return value
  throw new AgentTransportError(`平台响应字段不合法：${path} 不是受支持的步骤类型`)
}

function parseGit(value: unknown, path: string): RunPlanGit {
  const record = expectRecord(value, path)
  return {
    remoteUrl: expectString(record.remoteUrl, `${path}.remoteUrl`, 2_000),
    username: expectString(record.username, `${path}.username`, 200),
    password: expectString(record.password, `${path}.password`, 20_000),
    expiresAt: expectString(record.expiresAt, `${path}.expiresAt`, 40),
    commitSha: expectString(record.commitSha, `${path}.commitSha`, 64),
  }
}

function parseStep(value: unknown, path: string): RunPlanStep {
  const record = expectRecord(value, path)
  const step: RunPlanStep = {
    index: expectInteger(record.index, `${path}.index`, 0, 10_000),
    name: expectString(record.name, `${path}.name`, 120),
    kind: expectStepKind(record.kind, `${path}.kind`),
  }
  const run = optionalString(record.run, `${path}.run`, 65_536)
  if (run !== undefined) step.run = run
  const workingDirectory = optionalString(record.workingDirectory, `${path}.workingDirectory`, 500)
  if (workingDirectory !== undefined) step.workingDirectory = workingDirectory
  if (record.env !== undefined) step.env = expectStringRecord(record.env, `${path}.env`)
  if (record.timeoutSeconds !== undefined) {
    step.timeoutSeconds = expectInteger(record.timeoutSeconds, `${path}.timeoutSeconds`, 1, 43_200)
  }
  if (record.continueOnError !== undefined) {
    step.continueOnError = expectBoolean(record.continueOnError, `${path}.continueOnError`)
  }
  if (record.with !== undefined) step.with = expectStringRecord(record.with, `${path}.with`)
  return step
}

function parseJob(value: unknown, path: string): RunPlanJob {
  const record = expectRecord(value, path)
  if (!Array.isArray(record.steps) || record.steps.length === 0 || record.steps.length > 100) {
    throw new AgentTransportError(`平台响应字段不合法：${path}.steps 应为 1–100 项数组`)
  }
  const job: RunPlanJob = {
    id: expectString(record.id, `${path}.id`, 80),
    name: expectString(record.name, `${path}.name`, 80),
    image: expectString(record.image, `${path}.image`, 300),
    runsOn: expectStrategyArray(record.runsOn, `${path}.runsOn`, 1, 10),
    timeoutSeconds: expectInteger(record.timeoutSeconds, `${path}.timeoutSeconds`, 1, 86_400),
    steps: record.steps.map((step, index) => parseStep(step, `${path}.steps[${index}]`)),
  }
  if (record.env !== undefined) job.env = expectStringRecord(record.env, `${path}.env`)
  return job
}

function parseRunPlan(value: unknown, path: string): RunPlan {
  const record = expectRecord(value, path)
  if (!Array.isArray(record.jobs) || record.jobs.length === 0 || record.jobs.length > 50) {
    throw new AgentTransportError(`平台响应字段不合法：${path}.jobs 应为 1–50 项数组`)
  }
  return {
    runId: expectString(record.runId, `${path}.runId`, 64),
    workflowPath: expectString(record.workflowPath, `${path}.workflowPath`, 500),
    workflowName: expectString(record.workflowName, `${path}.workflowName`, 120),
    ref: expectString(record.ref, `${path}.ref`, 300),
    commitSha: expectString(record.commitSha, `${path}.commitSha`, 64),
    timeoutSeconds: expectInteger(record.timeoutSeconds, `${path}.timeoutSeconds`, 1, 86_400),
    inputs: expectInputs(record.inputs, `${path}.inputs`),
    env: expectStringRecord(record.env, `${path}.env`),
    git: parseGit(record.git, `${path}.git`),
    secrets: expectStringRecord(record.secrets, `${path}.secrets`),
    jobs: record.jobs.map((job, index) => parseJob(job, `${path}.jobs[${index}]`)),
  }
}

/**
 * 校验注册响应。
 * @param value 统一信封中的 data。
 * @returns 节点标识、Agent 令牌与心跳/租约参数。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseRegisterResponse(value: unknown): AgentRegisterResponse {
  const record = expectRecord(value, 'register')
  return {
    nodeId: expectString(record.nodeId, 'register.nodeId', 64),
    agentToken: expectString(record.agentToken, 'register.agentToken', 512),
    protocolVersion: expectInteger(record.protocolVersion, 'register.protocolVersion', 1, 1_000),
    heartbeatIntervalSeconds: expectInteger(
      record.heartbeatIntervalSeconds,
      'register.heartbeatIntervalSeconds',
      1,
      300,
    ),
    leaseTtlSeconds: expectInteger(record.leaseTtlSeconds, 'register.leaseTtlSeconds', 30, 600),
  }
}

/**
 * 校验心跳响应。
 * @param value 统一信封中的 data。
 * @returns 需要取消的租约标识与建议心跳间隔。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseHeartbeatResponse(value: unknown): AgentHeartbeatResponse {
  const record = expectRecord(value, 'heartbeat')
  const cancelLeaseIds = expectStrategyArray(record.cancelLeaseIds, 'heartbeat.cancelLeaseIds', 0, 20)
  return {
    cancelLeaseIds,
    heartbeatIntervalSeconds: expectInteger(
      record.heartbeatIntervalSeconds,
      'heartbeat.heartbeatIntervalSeconds',
      1,
      300,
    ),
  }
}

/**
 * 校验租约领取响应；无任务时平台返回 null。
 * @param value 统一信封中的 data。
 * @returns 租约或 null。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseLeaseResponse(value: unknown): PipelineLease | null {
  if (value === null || value === undefined) return null
  const record = expectRecord(value, 'lease')
  const lease: PipelineLease = {
    leaseId: expectString(record.leaseId, 'lease.leaseId', 64),
    leaseToken: expectString(record.leaseToken, 'lease.leaseToken', 512),
    expiresAt: expectString(record.expiresAt, 'lease.expiresAt', 40),
    heartbeatIntervalSeconds: expectInteger(record.heartbeatIntervalSeconds, 'lease.heartbeatIntervalSeconds', 1, 300),
    run: parseRunPlan(record.run, 'lease.run'),
  }
  return lease
}

/**
 * 校验续约响应。
 * @param value 统一信封中的 data。
 * @returns 新过期时间与取消标记。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseRenewResponse(value: unknown): AgentLeaseRenewResponse {
  const record = expectRecord(value, 'renew')
  return {
    expiresAt: expectString(record.expiresAt, 'renew.expiresAt', 40),
    cancelRequested: expectBoolean(record.cancelRequested, 'renew.cancelRequested'),
  }
}

/**
 * 校验步骤状态上报响应。
 * @param value 统一信封中的 data。
 * @returns 平台侧的步骤序号与状态。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseStepStatusResponse(value: unknown): AgentStepStatusResponse {
  const record = expectRecord(value, 'stepStatus')
  return {
    stepIndex: expectInteger(record.stepIndex, 'stepStatus.stepIndex', 0, 10_000),
    status: parseStepStatus(record.status, 'stepStatus.status'),
  }
}

function parseStepStatus(value: unknown, path: string): PipelineStepStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'cancelled'
  ) {
    return value
  }
  throw new AgentTransportError(`平台响应字段不合法：${path} 不是受支持的步骤状态`)
}

/**
 * 校验日志上传响应。
 * @param value 统一信封中的 data。
 * @returns 各步骤已接受的最大序号映射（键为步骤序号的字符串形式）。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseLogsResponse(value: unknown): AgentLogsResponse {
  const record = expectRecord(value, 'logs')
  const accepted = expectRecord(record.acceptedThrough, 'logs.acceptedThrough')
  const acceptedThrough: Record<string, number> = {}
  for (const [key, entry] of Object.entries(accepted)) {
    acceptedThrough[key] = expectInteger(entry, `logs.acceptedThrough.${key}`, 0, 2_000_000_000)
  }
  return { acceptedThrough }
}

/**
 * 校验产物上传响应。
 * @param value 统一信封中的 data。
 * @returns 平台登记的产物元数据。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseArtifactResponse(value: unknown): AgentArtifactUploadResponse {
  const record = expectRecord(value, 'artifact')
  return {
    artifactId: expectString(record.artifactId, 'artifact.artifactId', 64),
    name: expectString(record.name, 'artifact.name', 120),
    sizeBytes: expectInteger(record.sizeBytes, 'artifact.sizeBytes', 0, 2_147_483_648),
    sha256: expectString(record.sha256, 'artifact.sha256', 64),
  }
}

/**
 * 校验完成上报响应。
 * @param value 统一信封中的 data。
 * @returns 运行标识与平台记录的终态。
 * @throws AgentTransportError 字段缺失或类型不符时抛出。
 */
export function parseCompleteResponse(value: unknown): AgentCompleteResponse {
  const record = expectRecord(value, 'complete')
  const status = record.status
  if (
    status !== 'queued' &&
    status !== 'assigned' &&
    status !== 'running' &&
    status !== 'cancelling' &&
    status !== 'succeeded' &&
    status !== 'failed' &&
    status !== 'cancelled' &&
    status !== 'interrupted'
  ) {
    throw new AgentTransportError('平台响应字段不合法：complete.status 不是受支持的运行状态')
  }
  return {
    runId: expectString(record.runId, 'complete.runId', 64),
    status,
  }
}
