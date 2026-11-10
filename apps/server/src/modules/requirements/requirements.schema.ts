import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const statusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_development'),
  Type.Literal('submitted'),
  Type.Literal('in_testing'),
  Type.Literal('passed'),
  Type.Literal('cancelled'),
])
const ownerSchema = Type.Object({
  userId: uuidSchema,
  name: Type.String(),
  status: Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('missing')]),
  available: Type.Boolean(),
})
const requirementItemSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  number: Type.Integer(),
  title: Type.String(),
  status: statusSchema,
  devOwner: Type.Union([ownerSchema, Type.Null()]),
  testOwner: Type.Union([ownerSchema, Type.Null()]),
  version: Type.Integer(),
  updatedAt: Type.String(),
  needsReview: Type.Boolean(),
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
const testSubmissionSchema = Type.Object({
  id: uuidSchema,
  submittedByUserId: uuidSchema,
  devOwnerUserId: uuidSchema,
  testOwnerUserId: uuidSchema,
  scopeNote: Type.String(),
  selfTestResult: Type.String(),
  selfTestNote: Type.Union([Type.String(), Type.Null()]),
  testEntry: Type.Union([Type.String(), Type.Null()]),
  versionNote: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
})
const requirementDetailSchema = Type.Object({
  ...requirementItemSchema.properties,
  teamId: uuidSchema,
  contentMode: Type.Union([Type.Literal('markdown'), Type.Literal('external_link')]),
  contentMarkdown: Type.Union([Type.String(), Type.Null()]),
  externalUrl: Type.Union([Type.String(), Type.Null()]),
  externalSummary: Type.Union([Type.String(), Type.Null()]),
  acceptanceCriteria: Type.Union([Type.String(), Type.Null()]),
  collaborators: Type.Array(ownerSchema),
  latestTestSubmission: Type.Union([testSubmissionSchema, Type.Null()]),
  linkedBugs: Type.Array(
    Type.Object({ id: uuidSchema, number: Type.Integer(), title: Type.String(), status: Type.String() }),
  ),
  needsReview: Type.Boolean(),
  linkedCodeReferences: Type.Array(codeReferenceSchema),
  createdAt: Type.String(),
  createdByUserId: uuidSchema,
})
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
const pageMeta = {
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
}
const requirementListSchema = Type.Object({ items: Type.Array(requirementItemSchema), ...pageMeta })
const commentPageSchema = Type.Object({ items: Type.Array(commentSchema), ...pageMeta })
const activityPageSchema = Type.Object({ items: Type.Array(activitySchema), ...pageMeta })

export const requirementsQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  status: Type.Optional(statusSchema),
  ownerId: Type.Optional(uuidSchema),
  ownerUnavailable: Type.Optional(Type.Boolean()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const projectRequirementParamsSchema = Type.Object({ projectId: uuidSchema })
export const requirementParamsSchema = Type.Object({ requirementId: uuidSchema })
export const pageQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const createRequirementBodySchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    contentMode: Type.Union([Type.Literal('markdown'), Type.Literal('external_link')]),
    contentMarkdown: Type.Optional(Type.Union([Type.String({ maxLength: 100000 }), Type.Null()])),
    externalUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
    externalSummary: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    acceptanceCriteria: Type.Optional(Type.Union([Type.String({ maxLength: 20000 }), Type.Null()])),
    devOwnerUserId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    testOwnerUserId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    collaboratorUserIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 20 })),
  },
  { additionalProperties: false },
)
export const updateRequirementBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    contentMode: Type.Optional(Type.Union([Type.Literal('markdown'), Type.Literal('external_link')])),
    contentMarkdown: Type.Optional(Type.Union([Type.String({ maxLength: 100000 }), Type.Null()])),
    externalUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
    externalSummary: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    acceptanceCriteria: Type.Optional(Type.Union([Type.String({ maxLength: 20000 }), Type.Null()])),
    devOwnerUserId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    testOwnerUserId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    collaboratorUserIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 20 })),
  },
  { additionalProperties: false },
)
export const commentBodySchema = Type.Object(
  {
    bodyMarkdown: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
)

export const requirementListResponseSchema = apiResponseSchema(requirementListSchema)
export const requirementResponseSchema = apiResponseSchema(requirementDetailSchema)
export const commentPageResponseSchema = apiResponseSchema(commentPageSchema)
export const commentResponseSchema = apiResponseSchema(commentSchema)
export const activityPageResponseSchema = apiResponseSchema(activityPageSchema)

export const startDevelopmentBodySchema = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)
export const submitTestBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    testOwnerUserId: uuidSchema,
    scopeNote: Type.String({ minLength: 1, maxLength: 20000 }),
    selfTestResult: Type.Union([
      Type.Literal('passed'),
      Type.Literal('has_failures'),
      Type.Literal('not_run'),
      Type.Literal('not_applicable'),
    ]),
    selfTestNote: Type.Optional(Type.Union([Type.String({ maxLength: 5000 }), Type.Null()])),
    testEntry: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    versionNote: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
)
export const startTestBodySchema = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)
export const withdrawTestBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const returnToDevelopmentBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
    linkedBugIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 50 })),
  },
  { additionalProperties: false },
)
export const passTestBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    conclusion: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const reopenDevelopmentBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const cancelRequirementBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const restoreRequirementBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export const eligibilityResponseSchema = apiResponseSchema(
  Type.Object({
    eligible: Type.Boolean(),
    blockers: Type.Array(
      Type.Object({ id: uuidSchema, number: Type.Integer(), title: Type.String(), status: Type.String() }),
    ),
  }),
)
export const submitTestResponseSchema = apiResponseSchema(
  Type.Object({
    requirement: requirementDetailSchema,
    submission: testSubmissionSchema,
    activityId: uuidSchema,
  }),
)
export const testSubmissionPageResponseSchema = apiResponseSchema(
  Type.Object({
    items: Type.Array(testSubmissionSchema),
    ...pageMeta,
  }),
)
