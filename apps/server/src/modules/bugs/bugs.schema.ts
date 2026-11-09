import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.js'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const statusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_fix'),
  Type.Literal('in_regression'),
  Type.Literal('resolved'),
  Type.Literal('closed'),
])
const ownerSchema = Type.Object({ userId: uuidSchema, name: Type.String() })
const bugItemSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  number: Type.Integer(),
  title: Type.String(),
  status: statusSchema,
  fixOwner: Type.Union([ownerSchema, Type.Null()]),
  regressionOwner: Type.Union([ownerSchema, Type.Null()]),
  version: Type.Integer(),
  updatedAt: Type.String(),
})
const codeReferenceSchema = Type.Object({
  id: uuidSchema,
  repositoryId: uuidSchema,
  targetType: Type.String(),
  targetId: uuidSchema,
  objectType: Type.String(),
  remoteId: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.String(), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  lastCheckStatus: Type.String(),
  lastErrorCode: Type.Union([Type.String(), Type.Null()]),
  lastCheckedAt: Type.Union([Type.String(), Type.Null()]),
})
const linkedRequirementSchema = Type.Object({
  id: uuidSchema,
  number: Type.Integer(),
  title: Type.String(),
  status: Type.String(),
})
const regressionSchema = Type.Object({
  id: uuidSchema,
  attempt: Type.Integer(),
  fixSummary: Type.String(),
  fixer: ownerSchema,
  verifier: ownerSchema,
  result: Type.String(),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  verifiedAt: Type.Union([Type.String(), Type.Null()]),
})
const bugDetailSchema = Type.Object({
  ...bugItemSchema.properties,
  teamId: uuidSchema,
  phenomenon: Type.String(),
  expectedBehavior: Type.String(),
  reproduction: Type.Union([Type.String(), Type.Null()]),
  reproductionUnknown: Type.Boolean(),
  evidenceText: Type.Union([Type.String(), Type.Null()]),
  evidenceUrl: Type.Union([Type.String(), Type.Null()]),
  createdByUserId: uuidSchema,
  createdAt: Type.String(),
  linkedRequirements: Type.Array(linkedRequirementSchema),
  regressions: Type.Array(regressionSchema),
  linkedCodeReferences: Type.Array(codeReferenceSchema),
})
const pageMeta = { page: Type.Integer(), pageSize: Type.Integer(), total: Type.Integer() }
const bugListSchema = Type.Object({ items: Type.Array(bugItemSchema), ...pageMeta })
const commentSchema = Type.Object({
  id: uuidSchema,
  authorUserId: uuidSchema,
  bodyMarkdown: Type.String(),
  createdAt: Type.String(),
})
const activitySchema = Type.Object({
  id: uuidSchema,
  action: Type.String(),
  actorUserId: uuidSchema,
  changes: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
  note: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
})
const commentPageSchema = Type.Object({ items: Type.Array(commentSchema), ...pageMeta })
const activityPageSchema = Type.Object({ items: Type.Array(activitySchema), ...pageMeta })

export const bugsQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  status: Type.Optional(statusSchema),
  ownerId: Type.Optional(uuidSchema),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const projectBugParamsSchema = Type.Object({ projectId: uuidSchema })
export const bugParamsSchema = Type.Object({ bugId: uuidSchema })
export const bugRequirementParamsSchema = Type.Object({ bugId: uuidSchema, requirementId: uuidSchema })
export const pageQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
const versionSchema = Type.Integer({ minimum: 1 })
const reproductionSchema = Type.Optional(Type.Union([Type.String({ maxLength: 20000 }), Type.Null()]))
export const createBugBodySchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    phenomenon: Type.String({ minLength: 1, maxLength: 20000 }),
    expectedBehavior: Type.String({ minLength: 1, maxLength: 20000 }),
    reproduction: reproductionSchema,
    reproductionUnknown: Type.Optional(Type.Boolean()),
    evidenceText: Type.Optional(Type.Union([Type.String({ maxLength: 20000 }), Type.Null()])),
    evidenceUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
    fixOwnerUserId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    requirementIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 20 })),
  },
  { additionalProperties: false },
)
export const updateBugBodySchema = Type.Object(
  {
    version: versionSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    phenomenon: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })),
    expectedBehavior: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })),
    reproduction: reproductionSchema,
    reproductionUnknown: Type.Optional(Type.Boolean()),
    evidenceText: Type.Optional(Type.Union([Type.String({ maxLength: 20000 }), Type.Null()])),
    evidenceUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
    fixOwnerUserId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  },
  { additionalProperties: false },
)
export const startFixBodySchema = Type.Object({ version: versionSchema }, { additionalProperties: false })
export const submitRegressionBodySchema = Type.Object(
  {
    version: versionSchema,
    fixSummary: Type.String({ minLength: 1, maxLength: 20000 }),
    verifierUserId: Type.Optional(uuidSchema),
  },
  { additionalProperties: false },
)
export const withdrawRegressionBodySchema = Type.Object(
  {
    version: versionSchema,
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const recordRegressionBodySchema = Type.Object(
  {
    version: versionSchema,
    result: Type.Union([Type.Literal('passed'), Type.Literal('failed')]),
    note: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const closeBugBodySchema = Type.Object(
  {
    version: versionSchema,
    category: Type.Union([Type.Literal('duplicate'), Type.Literal('not_bug'), Type.Literal('wont_fix')]),
    note: Type.String({ minLength: 1, maxLength: 2000 }),
    duplicateOfBugId: Type.Optional(uuidSchema),
  },
  { additionalProperties: false },
)
export const reopenBugBodySchema = Type.Object(
  {
    version: versionSchema,
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const linkRequirementBodySchema = Type.Object(
  {
    version: versionSchema,
    requirementId: uuidSchema,
  },
  { additionalProperties: false },
)
export const unlinkRequirementBodySchema = Type.Object(
  {
    version: versionSchema,
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const commentBodySchema = Type.Object(
  { bodyMarkdown: Type.String({ minLength: 1, maxLength: 20000 }) },
  { additionalProperties: false },
)
const submitRegressionResultSchema = Type.Object({
  bug: bugDetailSchema,
  regression: regressionSchema,
  activityId: uuidSchema,
})

export const bugListResponseSchema = apiResponseSchema(bugListSchema)
export const bugResponseSchema = apiResponseSchema(bugDetailSchema)
export const submitRegressionResponseSchema = apiResponseSchema(submitRegressionResultSchema)
export const commentResponseSchema = apiResponseSchema(commentSchema)
export const commentPageResponseSchema = apiResponseSchema(commentPageSchema)
export const activityPageResponseSchema = apiResponseSchema(activityPageSchema)
