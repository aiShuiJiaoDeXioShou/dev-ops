import { Type, type Static } from 'typebox'

const id = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const optionalComment = Type.Optional(Type.String({ maxLength: 4000 }))

export const submitTaskResultInput = Type.Object(
  {
    body: Type.String({ minLength: 1, maxLength: 24000 }),
    completionNote: Type.String({ minLength: 1, maxLength: 4000 }),
    evidence: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 20 }),
    tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 12 })),
  },
  { additionalProperties: false },
)
export const acceptTaskResultBody = Type.Object(
  { resultId: id, comment: optionalComment },
  { additionalProperties: false },
)
export const requestTaskChangesBody = Type.Object(
  { resultId: id, comment: Type.String({ minLength: 1, maxLength: 4000 }) },
  { additionalProperties: false },
)
export const taskResultSchema = Type.Object({
  id,
  taskId: id,
  runId: id,
  body: Type.String(),
  completionNote: Type.String(),
  evidence: Type.Array(Type.String()),
  submittedByBotId: id,
  createdAt: Type.String(),
})
export const taskReviewSchema = Type.Object({
  id,
  resultId: id,
  decision: Type.Union([Type.Literal('accepted'), Type.Literal('changes_requested')]),
  comment: Type.Union([Type.String(), Type.Null()]),
  reviewerUserId: id,
  createdAt: Type.String(),
})

export type SubmitTaskResultInput = Static<typeof submitTaskResultInput>
export type TaskResultView = Static<typeof taskResultSchema>
export type TaskReviewView = Static<typeof taskReviewSchema>
