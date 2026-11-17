import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'
import { taskResultSchema, taskReviewSchema } from './bot-tasks.review.schema.ts'

const id = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const nullableId = Type.Union([id, Type.Null()])
const nullableText = Type.Union([Type.String(), Type.Null()])
const version = Type.Integer({ minimum: 1, maximum: 2147483647 })
const taskStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_progress'),
  Type.Literal('waiting'),
  Type.Literal('awaiting_review'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
])
const waitReason = Type.Union([
  Type.Literal('needs_input'),
  Type.Literal('run_failed'),
  Type.Literal('executor_unavailable'),
  Type.Literal('stopped'),
  Type.Null(),
])
const runStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('stopped'),
])
const task = Type.Object({
  id,
  teamId: id,
  conversationId: id,
  title: Type.String(),
  acceptanceCriteria: Type.String(),
  businessOwnerId: id,
  executorBotId: id,
  status: taskStatus,
  waitReason,
  blocked: Type.Boolean(),
  version,
  inputVersion: version,
  createdBy: id,
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
const run = Type.Object({
  id,
  botId: id,
  triggerUserId: id,
  inputVersion: Type.Integer({ minimum: 0 }),
  status: runStatus,
  stopRequested: Type.Boolean(),
  createdAt: Type.String(),
  startedAt: nullableText,
  finishedAt: nullableText,
  modelConnectionId: nullableId,
  modelId: nullableText,
  failureKind: nullableText,
  failureMessage: nullableText,
  turns: Type.Integer({ minimum: 0 }),
  usage: Type.Unknown(),
})
const input = Type.Object({
  id,
  inputVersion: version,
  content: Type.String(),
  createdBy: id,
  createdAt: Type.String(),
})
const trace = Type.Object({
  id,
  runId: id,
  kind: Type.String(),
  state: Type.String(),
  summary: nullableText,
  createdAt: Type.String(),
})

export const taskParams = Type.Object({ taskId: id })
export const runParams = Type.Object({ runId: id })
export const taskListQuery = Type.Object({ cursor: Type.Optional(id) }, { additionalProperties: false })
export const taskCreateBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    acceptanceCriteria: Type.String({ minLength: 1, maxLength: 8000 }),
    businessOwnerId: id,
    executorBotId: Type.Optional(id),
    input: Type.Optional(Type.String({ maxLength: 16000 })),
  },
  { additionalProperties: false },
)
export const taskHandoffBody = Type.Object(
  {
    version,
    toBotId: id,
    reason: Type.String({ minLength: 1, maxLength: 4000 }),
    summary: Type.String({ minLength: 1, maxLength: 8000 }),
    unfinished: Type.String({ maxLength: 8000 }),
  },
  { additionalProperties: false },
)
export const taskAppendBody = Type.Object(
  { version, content: Type.String({ minLength: 1, maxLength: 16000 }) },
  { additionalProperties: false },
)
export const taskVersionBody = Type.Object({ version }, { additionalProperties: false })
export const taskRunResponse = apiResponseSchema(
  Type.Object({ task, runId: nullableId, runStatus: Type.Union([runStatus, Type.Null()]) }),
)
export const taskListResponse = apiResponseSchema(Type.Object({ items: Type.Array(task), nextCursor: nullableId }))
export const taskDetailResponse = apiResponseSchema(
  Type.Object({
    ...task.properties,
    inputs: Type.Array(input),
    runs: Type.Array(run),
    trace: Type.Array(trace),
    results: Type.Array(taskResultSchema),
    reviews: Type.Array(taskReviewSchema),
    handoffs: Type.Array(
      Type.Object({
        id,
        fromBotId: id,
        toBotId: id,
        reason: Type.String(),
        summary: Type.String(),
        unfinished: Type.String(),
        createdAt: Type.String(),
        createdBy: id,
      }),
    ),
  }),
)
export const taskResponse = apiResponseSchema(task)
export const taskReviewResponse = apiResponseSchema(Type.Object({ task, review: taskReviewSchema }))
export const runResponse = apiResponseSchema(run)

export type BotTaskView = Static<typeof task>
export type TaskRunView = Static<typeof run>
export type TaskTraceView = Static<typeof trace>
export type CreateBotTaskInput = Static<typeof taskCreateBody>
export type AppendBotTaskInput = Static<typeof taskAppendBody>
export type BotTaskHandoffInput = Static<typeof taskHandoffBody>
