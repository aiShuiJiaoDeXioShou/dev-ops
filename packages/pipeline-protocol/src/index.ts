import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

/** 运行终态与中间状态；与 data-model.md 的 pipeline_run.status 保持一致。 */
export const PipelineRunStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('assigned'),
  Type.Literal('running'),
  Type.Literal('cancelling'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
])
export type PipelineRunStatus = Static<typeof PipelineRunStatusSchema>

/** 步骤状态；与 data-model.md 的 pipeline_run_step.status 保持一致。 */
export const PipelineStepStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('cancelled'),
])
export type PipelineStepStatus = Static<typeof PipelineStepStatusSchema>

/** P1 支持的内置步骤类型。 */
export const PipelineStepKindSchema = Type.Union([
  Type.Literal('run'),
  Type.Literal('builtin_checkout'),
  Type.Literal('builtin_upload_artifact'),
])
export type PipelineStepKind = Static<typeof PipelineStepKindSchema>

/** 手动触发输入值。 */
export const PipelineInputValueSchema = Type.Union([Type.String({ maxLength: 4096 }), Type.Boolean(), Type.Number()])
export type PipelineInputValue = Static<typeof PipelineInputValueSchema>

export const PipelineInputsSchema = Type.Record(Type.String(), PipelineInputValueSchema)
export type PipelineInputs = Static<typeof PipelineInputsSchema>

export const PipelineEnvSchema = Type.Record(Type.String(), Type.String({ maxLength: 32_768 }))
export type PipelineEnv = Static<typeof PipelineEnvSchema>

/** 运行计划中的一个步骤；step.index 为运行内全局序号。 */
export const RunPlanStepSchema = Type.Object({
  index: Type.Integer({ minimum: 0, maximum: 10_000 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  kind: PipelineStepKindSchema,
  run: Type.Optional(Type.String({ maxLength: 65_536 })),
  workingDirectory: Type.Optional(Type.String({ maxLength: 500 })),
  env: Type.Optional(PipelineEnvSchema),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 43_200 })),
  continueOnError: Type.Optional(Type.Boolean()),
  with: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 500 }))),
})
export type RunPlanStep = Static<typeof RunPlanStepSchema>

/** 运行计划中的一个 job；P1 由 Agent 串行执行。 */
export const RunPlanJobSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80 }),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  image: Type.String({ minLength: 1, maxLength: 300 }),
  runsOn: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 1, maxItems: 10 }),
  timeoutSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
  env: Type.Optional(PipelineEnvSchema),
  steps: Type.Array(RunPlanStepSchema, { minItems: 1, maxItems: 100 }),
})
export type RunPlanJob = Static<typeof RunPlanJobSchema>

/** Git 检出信息；凭据只在租约有效期内使用，不落盘。 */
export const RunPlanGitSchema = Type.Object({
  remoteUrl: Type.String({ minLength: 1, maxLength: 2_000 }),
  username: Type.String({ minLength: 1, maxLength: 200 }),
  password: Type.String({ minLength: 1, maxLength: 20_000 }),
  expiresAt: Type.String({ minLength: 1, maxLength: 40 }),
  commitSha: Type.String({ pattern: '^[0-9a-f]{7,64}$' }),
})
export type RunPlanGit = Static<typeof RunPlanGitSchema>

/** 平台生成并固定下来的完整运行计划；Agent 只执行、不改写。 */
export const RunPlanSchema = Type.Object({
  runId: Type.String({ minLength: 1, maxLength: 64 }),
  workflowPath: Type.String({ minLength: 1, maxLength: 500 }),
  workflowName: Type.String({ minLength: 1, maxLength: 120 }),
  ref: Type.String({ minLength: 1, maxLength: 300 }),
  commitSha: Type.String({ pattern: '^[0-9a-f]{7,64}$' }),
  timeoutSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
  inputs: PipelineInputsSchema,
  env: PipelineEnvSchema,
  git: RunPlanGitSchema,
  secrets: PipelineEnvSchema,
  jobs: Type.Array(RunPlanJobSchema, { minItems: 1, maxItems: 50 }),
})
export type RunPlan = Static<typeof RunPlanSchema>

/** 节点注册请求；registrationToken 只使用一次。 */
export const AgentRegisterRequestSchema = Type.Object({
  registrationToken: Type.String({ minLength: 20, maxLength: 512 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  os: Type.String({ minLength: 1, maxLength: 40 }),
  arch: Type.String({ minLength: 1, maxLength: 40 }),
  capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 1, maxItems: 30 }),
  agentVersion: Type.String({ minLength: 1, maxLength: 40 }),
})
export type AgentRegisterRequest = Static<typeof AgentRegisterRequestSchema>

export const AgentRegisterResponseSchema = Type.Object({
  nodeId: Type.String({ minLength: 1, maxLength: 64 }),
  agentToken: Type.String({ minLength: 20, maxLength: 512 }),
  protocolVersion: Type.Integer({ minimum: 1 }),
  heartbeatIntervalSeconds: Type.Integer({ minimum: 1, maximum: 300 }),
  leaseTtlSeconds: Type.Integer({ minimum: 30, maximum: 600 }),
})
export type AgentRegisterResponse = Static<typeof AgentRegisterResponseSchema>

/** Agent 心跳；返回需要取消的租约。metrics 为可选负载摘要，P1 不参与调度。 */
export const AgentHeartbeatRequestSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 40 }),
  runningLeaseId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()])),
  capabilities: Type.Optional(Type.Union([Type.Array(Type.String({ maxLength: 80 }), { maxItems: 30 }), Type.Null()])),
  metrics: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
})
export type AgentHeartbeatRequest = Static<typeof AgentHeartbeatRequestSchema>

export const AgentHeartbeatResponseSchema = Type.Object({
  cancelLeaseIds: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20 }),
  heartbeatIntervalSeconds: Type.Integer({ minimum: 1, maximum: 300 }),
})
export type AgentHeartbeatResponse = Static<typeof AgentHeartbeatResponseSchema>

export const AgentLeaseRequestSchema = Type.Object({
  waitSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 30 })),
})
export type AgentLeaseRequest = Static<typeof AgentLeaseRequestSchema>

/** 一次租约；run 为平台固定后的运行计划。 */
export const PipelineLeaseSchema = Type.Object({
  leaseId: Type.String({ minLength: 1, maxLength: 64 }),
  leaseToken: Type.String({ minLength: 20, maxLength: 512 }),
  expiresAt: Type.String({ minLength: 1, maxLength: 40 }),
  heartbeatIntervalSeconds: Type.Integer({ minimum: 1, maximum: 300 }),
  run: RunPlanSchema,
})
export type PipelineLease = Static<typeof PipelineLeaseSchema>

/** 领取任务的响应 data：无任务时为 null，有任务时直接返回租约对象。 */
export const AgentLeaseResponseSchema = Type.Union([PipelineLeaseSchema, Type.Null()])
export type AgentLeaseResponse = Static<typeof AgentLeaseResponseSchema>

/** 租约续约请求；令牌同时通过 X-Lease-Token 请求头传递。 */
export const AgentLeaseRenewRequestSchema = Type.Object({
  leaseToken: Type.String({ minLength: 20, maxLength: 512 }),
})
export type AgentLeaseRenewRequest = Static<typeof AgentLeaseRenewRequestSchema>

/** 租约续约响应；cancelRequested 为真时必须尽快停止执行。 */
export const AgentLeaseRenewResponseSchema = Type.Object({
  expiresAt: Type.String({ minLength: 1, maxLength: 40 }),
  cancelRequested: Type.Boolean(),
})
export type AgentLeaseRenewResponse = Static<typeof AgentLeaseRenewResponseSchema>

/** 步骤状态上报；退出码与错误信息由 Agent 生成。 */
export const AgentStepStatusRequestSchema = Type.Object({
  status: PipelineStepStatusSchema,
  exitCode: Type.Optional(Type.Union([Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }), Type.Null()])),
  errorCode: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
  errorMessage: Type.Optional(Type.Union([Type.String({ maxLength: 4_000 }), Type.Null()])),
})
export type AgentStepStatusRequest = Static<typeof AgentStepStatusRequestSchema>

/** 步骤状态上报响应 data；重复上报返回平台当前状态。 */
export const AgentStepStatusResponseSchema = Type.Object({
  stepIndex: Type.Integer({ minimum: 0 }),
  status: PipelineStepStatusSchema,
})
export type AgentStepStatusResponse = Static<typeof AgentStepStatusResponseSchema>

/** 日志分片；seq 在 stepIndex 内严格递增且不重复。 */
export const AgentLogChunkSchema = Type.Object({
  stepIndex: Type.Integer({ minimum: 0, maximum: 10_000 }),
  seq: Type.Integer({ minimum: 0, maximum: 2_000_000_000 }),
  content: Type.String({ maxLength: 262_144 }),
})
export type AgentLogChunk = Static<typeof AgentLogChunkSchema>

export const AgentLogsRequestSchema = Type.Object({
  chunks: Type.Array(AgentLogChunkSchema, { minItems: 1, maxItems: 20 }),
})
export type AgentLogsRequest = Static<typeof AgentLogsRequestSchema>

export const AgentLogsResponseSchema = Type.Object({
  acceptedThrough: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
})
export type AgentLogsResponse = Static<typeof AgentLogsResponseSchema>

/** 产物上传响应 data；同一运行产物名唯一，重复上传返回冲突。 */
export const AgentArtifactUploadResponseSchema = Type.Object({
  artifactId: Type.String({ minLength: 1, maxLength: 64 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
})
export type AgentArtifactUploadResponse = Static<typeof AgentArtifactUploadResponseSchema>

/** 完成上报；终态不得把失败写成成功。 */
export const AgentCompleteRequestSchema = Type.Object({
  status: Type.Union([
    Type.Literal('succeeded'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
    Type.Literal('interrupted'),
  ]),
  errorCode: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
  errorMessage: Type.Optional(Type.Union([Type.String({ maxLength: 4_000 }), Type.Null()])),
})
export type AgentCompleteRequest = Static<typeof AgentCompleteRequestSchema>

/** 完成上报响应 data；重复完成返回同一终态结果。 */
export const AgentCompleteResponseSchema = Type.Object({
  runId: Type.String({ minLength: 1, maxLength: 64 }),
  status: PipelineRunStatusSchema,
})
export type AgentCompleteResponse = Static<typeof AgentCompleteResponseSchema>

/** Agent 协议错误码；与平台 ERROR_CODES 同名，Agent 可据此决定重试与停止策略。 */
export const AGENT_ERROR_CODES = {
  AGENT_TOKEN_INVALID: 'AGENT_TOKEN_INVALID',
  AGENT_REGISTRATION_TOKEN_INVALID: 'AGENT_REGISTRATION_TOKEN_INVALID',
  AGENT_NODE_DISABLED: 'AGENT_NODE_DISABLED',
  AGENT_LEASE_EXPIRED: 'AGENT_LEASE_EXPIRED',
  AGENT_LEASE_INVALID: 'AGENT_LEASE_INVALID',
  AGENT_STEP_STATE_CONFLICT: 'AGENT_STEP_STATE_CONFLICT',
  AGENT_LOG_SEQ_CONFLICT: 'AGENT_LOG_SEQ_CONFLICT',
  AGENT_LOG_LIMIT_EXCEEDED: 'AGENT_LOG_LIMIT_EXCEEDED',
  AGENT_ARTIFACT_LIMIT_EXCEEDED: 'AGENT_ARTIFACT_LIMIT_EXCEEDED',
  AGENT_VERSION_UNSUPPORTED: 'AGENT_VERSION_UNSUPPORTED',
  PIPELINE_STORAGE_ERROR: 'PIPELINE_STORAGE_ERROR',
} as const
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES]

const AGENT_ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.values(AGENT_ERROR_CODES))

/** 判断字符串是否为 Agent 协议错误码；用于客户端按错误码决定是否重试。 */
export function isAgentErrorCode(value: string): value is AgentErrorCode {
  return AGENT_ERROR_CODE_SET.has(value)
}

/**
 * 校验运行计划内部的步骤全局序号唯一。
 * @param plan 运行计划或计划模板的 jobs 部分。
 * @returns 所有 step.index 不重复时为 true；TypeBox 无法表达跨数组唯一性，这里补充校验。
 */
export function hasUniqueStepIndexes(plan: Pick<RunPlan, 'jobs'>): boolean {
  const seen = new Set<number>()
  for (const job of plan.jobs) {
    for (const step of job.steps) {
      if (seen.has(step.index)) return false
      seen.add(step.index)
    }
  }
  return true
}

/**
 * 校验未知数据是否为合法运行计划（结构 + step.index 全局唯一）。
 * @param value 待校验的未知数据。
 * @returns 通过时为 true，并把类型收窄为 RunPlan。
 */
export function validateRunPlan(value: unknown): value is RunPlan {
  return Value.Check(RunPlanSchema, value) && hasUniqueStepIndexes(value)
}

export const PROTOCOL_VERSION = 1 as const
