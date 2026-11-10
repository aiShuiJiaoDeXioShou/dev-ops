import { Type } from 'typebox'
import {
  AgentArtifactUploadResponseSchema,
  AgentCompleteRequestSchema,
  AgentCompleteResponseSchema,
  AgentHeartbeatRequestSchema,
  AgentHeartbeatResponseSchema,
  AgentLeaseRenewRequestSchema,
  AgentLeaseRenewResponseSchema,
  AgentLeaseRequestSchema,
  AgentLeaseResponseSchema,
  AgentLogsResponseSchema,
  AgentRegisterRequestSchema,
  AgentRegisterResponseSchema,
  AgentStepStatusRequestSchema,
  AgentStepStatusResponseSchema,
  PipelineInputsSchema,
} from '@dev-ops/pipeline-protocol'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })

export const pipelineProjectParamsSchema = Type.Object({ projectId: uuidSchema })
export const pipelineRunParamsSchema = Type.Object({ runId: uuidSchema })
export const pipelineNodeParamsSchema = Type.Object({ nodeId: uuidSchema })
export const pipelineArtifactParamsSchema = Type.Object({ artifactId: uuidSchema })
export const pipelineTeamParamsSchema = Type.Object({ teamId: uuidSchema })
export const pipelineLeaseParamsSchema = Type.Object({ leaseId: Type.String({ minLength: 1, maxLength: 64 }) })
export const pipelineLeaseStepParamsSchema = Type.Object({
  leaseId: Type.String({ minLength: 1, maxLength: 64 }),
  stepIndex: Type.Integer({ minimum: 0, maximum: 10_000 }),
})

export const pipelineWorkflowListQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ maxLength: 300 })),
})

export const pipelineWorkflowDetailQuerySchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 500 }),
  ref: Type.Optional(Type.String({ maxLength: 300 })),
})

/** 运行状态筛选枚举；与 data-model.md 的运行状态一致，避免接受任意状态字符串。 */
const pipelineRunStatusFilterSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('assigned'),
  Type.Literal('running'),
  Type.Literal('cancelling'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
])

export const pipelineRunListQuerySchema = Type.Object({
  workflowPath: Type.Optional(Type.String({ maxLength: 500 })),
  status: Type.Optional(pipelineRunStatusFilterSchema),
  from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  to: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

export const pipelineTriggerBodySchema = Type.Object(
  {
    workflowPath: Type.String({ minLength: 1, maxLength: 500 }),
    ref: Type.String({ minLength: 1, maxLength: 300 }),
    inputs: Type.Optional(PipelineInputsSchema),
    idempotencyKey: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
)

export const pipelineCancelBodySchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
)

/** Agent 日志上传的 HTTP 契约上限；业务上限由 PIPELINE_LOG_CHUNK_MAX_BYTES 判定并返回 AGENT_LOG_LIMIT_EXCEEDED。 */
const AGENT_LOG_SCHEMA_CHUNK_MAX = 1_048_576

export const agentLogsUploadSchema = Type.Object({
  chunks: Type.Array(
    Type.Object({
      stepIndex: Type.Integer({ minimum: 0, maximum: 10_000 }),
      seq: Type.Integer({ minimum: 0, maximum: 2_000_000_000 }),
      content: Type.String({ maxLength: AGENT_LOG_SCHEMA_CHUNK_MAX }),
    }),
    { minItems: 1, maxItems: 20 },
  ),
})

export const pipelineLogQuerySchema = Type.Object({
  stepIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
  // afterSeq 为“不含”游标；日志序号从 0 开始，默认 -1 才能包含首片。
  afterSeq: Type.Optional(Type.Integer({ minimum: -1, maximum: 2_000_000_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

export const pipelineCreateNodeBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 1, maxItems: 30 }),
  },
  { additionalProperties: false },
)

const parseErrorSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  fieldPath: Type.Optional(Type.String()),
  line: Type.Optional(Type.Integer({ minimum: 1 })),
  column: Type.Optional(Type.Integer({ minimum: 1 })),
})

const lastRunSchema = Type.Union([
  Type.Object({ runId: Type.String(), status: Type.String(), createdAt: Type.String() }),
  Type.Null(),
])

const workflowItemSchema = Type.Object({
  path: Type.String(),
  name: Type.String(),
  valid: Type.Boolean(),
  parseErrors: Type.Array(parseErrorSchema),
  lastRun: lastRunSchema,
})

const workflowListSchema = Type.Object({
  ref: Type.String(),
  commitSha: Type.String(),
  items: Type.Array(workflowItemSchema),
})

const workflowPlanSummarySchema = Type.Object({
  jobs: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      steps: Type.Array(Type.Object({ index: Type.Integer(), name: Type.String(), kind: Type.String() })),
    }),
  ),
})

const workflowInputSchema = Type.Object({
  name: Type.String(),
  type: Type.String(),
  required: Type.Boolean(),
  defaultValue: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
  options: Type.Optional(Type.Array(Type.String())),
  description: Type.Optional(Type.String()),
})

const workflowDetailSchema = Type.Object({
  path: Type.String(),
  name: Type.String(),
  repositoryId: uuidSchema,
  ref: Type.String(),
  commitSha: Type.String(),
  content: Type.String(),
  contentHash: Type.String(),
  valid: Type.Boolean(),
  parseErrors: Type.Array(parseErrorSchema),
  planSummary: Type.Union([workflowPlanSummarySchema, Type.Null()]),
  inputs: Type.Array(workflowInputSchema),
})

const nullableString = Type.Union([Type.String(), Type.Null()])

export const pipelineRunViewSchema = Type.Object({
  runId: uuidSchema,
  projectId: uuidSchema,
  repositoryId: uuidSchema,
  workflowPath: Type.String(),
  workflowName: nullableString,
  ref: Type.String(),
  commitSha: Type.String(),
  status: Type.String(),
  triggerSource: Type.String(),
  initiatorChannel: Type.String(),
  triggeredByUserId: uuidSchema,
  initiator: Type.String(),
  nodeId: nullableString,
  nodeName: nullableString,
  errorCode: nullableString,
  errorMessage: nullableString,
  durationSeconds: Type.Union([Type.Integer(), Type.Null()]),
  cancelRequestedAt: nullableString,
  createdAt: Type.String(),
  assignedAt: nullableString,
  startedAt: nullableString,
  finishedAt: nullableString,
})

const stepViewSchema = Type.Object({
  index: Type.Integer(),
  name: Type.String(),
  kind: Type.String(),
  status: Type.String(),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  errorCode: nullableString,
  errorMessage: nullableString,
  startedAt: nullableString,
  finishedAt: nullableString,
})

const artifactViewSchema = Type.Object({
  artifactId: uuidSchema,
  runId: uuidSchema,
  name: Type.String(),
  stepIndex: Type.Integer(),
  sizeBytes: Type.Integer(),
  sha256: Type.String(),
  status: Type.String(),
  createdAt: Type.String(),
  downloadUrl: Type.String(),
})

const logStatViewSchema = Type.Object({
  stepIndex: Type.Integer(),
  chunkCount: Type.Integer(),
  sizeBytes: Type.Integer(),
  lastSeq: Type.Integer(),
})

const runDetailSchema = Type.Intersect([
  pipelineRunViewSchema,
  Type.Object({
    inputs: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])),
    steps: Type.Array(stepViewSchema),
    artifacts: Type.Array(artifactViewSchema),
    logs: Type.Object({ items: Type.Array(logStatViewSchema), totalSizeBytes: Type.Integer() }),
  }),
])

const runListSchema = Type.Object({
  items: Type.Array(pipelineRunViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

const logReadSchema = Type.Object({
  stepIndex: Type.Union([Type.Integer(), Type.Null()]),
  items: Type.Array(Type.Object({ seq: Type.Integer(), content: Type.String(), truncated: Type.Boolean() })),
  nextSeq: Type.Integer(),
  hasMore: Type.Boolean(),
})

const artifactListSchema = Type.Object({ items: Type.Array(artifactViewSchema) })

export const pipelineNodeViewSchema = Type.Object({
  nodeId: uuidSchema,
  teamId: uuidSchema,
  name: Type.String(),
  status: Type.String(),
  os: Type.String(),
  arch: Type.String(),
  capabilities: Type.Array(Type.String()),
  concurrencyLimit: Type.Integer(),
  agentVersion: nullableString,
  lastHeartbeatAt: nullableString,
  lastErrorCode: nullableString,
  currentRunId: nullableString,
  disabledAt: nullableString,
  createdAt: Type.String(),
})

const nodeListSchema = Type.Object({ items: Type.Array(pipelineNodeViewSchema) })
const nodeResultSchema = Type.Object({ node: pipelineNodeViewSchema })

const createNodeResultSchema = Type.Object({
  node: pipelineNodeViewSchema,
  registrationToken: Type.String(),
  registrationTokenExpiresAt: Type.String(),
})

const rotateTokenResultSchema = Type.Object({
  nodeId: uuidSchema,
  agentToken: Type.String(),
  createdAt: Type.String(),
})

export const pipelineWorkflowListResponseSchema = apiResponseSchema(workflowListSchema)
export const pipelineWorkflowDetailResponseSchema = apiResponseSchema(workflowDetailSchema)
export const pipelineRunDetailResponseSchema = apiResponseSchema(runDetailSchema)
export const pipelineRunListResponseSchema = apiResponseSchema(runListSchema)
export const pipelineLogResponseSchema = apiResponseSchema(logReadSchema)
export const pipelineArtifactListResponseSchema = apiResponseSchema(artifactListSchema)
export const pipelineNodeListResponseSchema = apiResponseSchema(nodeListSchema)
export const pipelineNodeResponseSchema = apiResponseSchema(nodeResultSchema)
export const pipelineCreateNodeResponseSchema = apiResponseSchema(createNodeResultSchema)
export const pipelineRotateTokenResponseSchema = apiResponseSchema(rotateTokenResultSchema)

export const agentRegisterResponseSchema = apiResponseSchema(AgentRegisterResponseSchema)
export const agentHeartbeatResponseSchema = apiResponseSchema(AgentHeartbeatResponseSchema)
export const agentLeaseResponseSchema = apiResponseSchema(AgentLeaseResponseSchema)
export const agentRenewResponseSchema = apiResponseSchema(AgentLeaseRenewResponseSchema)
export const agentStepStatusResponseSchema = apiResponseSchema(AgentStepStatusResponseSchema)
export const agentLogsResponseSchema = apiResponseSchema(AgentLogsResponseSchema)
export const agentCompleteResponseSchema = apiResponseSchema(AgentCompleteResponseSchema)
export const agentArtifactUploadResponseSchema = apiResponseSchema(AgentArtifactUploadResponseSchema)

export {
  AgentCompleteRequestSchema,
  AgentHeartbeatRequestSchema,
  AgentLeaseRenewRequestSchema,
  AgentLeaseRequestSchema,
  AgentRegisterRequestSchema,
  AgentStepStatusRequestSchema,
}
