import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const timestampSchema = Type.String({ minLength: 1, maxLength: 40 })
const environmentSchema = Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')])
const resultStatusSchema = Type.Union([
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('unknown'),
])
const sourceSchema = Type.Union([
  Type.Literal('pipeline'),
  Type.Literal('local'),
  Type.Literal('external_system'),
  Type.Literal('manual'),
])
const artifactTypeSchema = Type.Union([
  Type.Literal('mobile_package'),
  Type.Literal('mini_program_qr'),
  Type.Literal('web_test_url'),
])
const targetTypeSchema = Type.Union([Type.Literal('requirement'), Type.Literal('bug')])

const artifactInputSchema = Type.Object(
  {
    artifactType: artifactTypeSchema,
    accessUrl: Type.String({ minLength: 1, maxLength: 2000 }),
    versionLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    collectedAt: Type.Optional(timestampSchema),
    note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
)

const targetInputSchema = Type.Object(
  { targetType: targetTypeSchema, targetId: uuidSchema },
  { additionalProperties: false },
)

export const reportBuildBodySchema = Type.Object(
  {
    serviceId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    environment: Type.Optional(Type.Union([environmentSchema, Type.Null()])),
    buildKey: Type.String({ minLength: 1, maxLength: 200 }),
    versionLabel: Type.String({ minLength: 1, maxLength: 200 }),
    commitRef: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])),
    source: sourceSchema,
    sourceRunId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])),
    collectedAt: timestampSchema,
    resultStatus: resultStatusSchema,
    note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    artifacts: Type.Optional(Type.Array(artifactInputSchema, { maxItems: 20 })),
    targets: Type.Optional(Type.Array(targetInputSchema, { maxItems: 20 })),
  },
  { additionalProperties: false },
)

export const correctBuildBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    versionLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    commitRef: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])),
    resultStatus: Type.Optional(resultStatusSchema),
    note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
)

export const addArtifactBodySchema = artifactInputSchema
export const linkTargetBodySchema = targetInputSchema
export const unlinkTargetBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false },
)

export const buildListQuerySchema = Type.Object({
  serviceId: Type.Optional(uuidSchema),
  environment: Type.Optional(environmentSchema),
  source: Type.Optional(sourceSchema),
  resultStatus: Type.Optional(resultStatusSchema),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const buildParamsSchema = Type.Object({ buildId: uuidSchema })
export const buildTargetParamsSchema = Type.Object({ buildId: uuidSchema, targetId: uuidSchema })
export const projectParamsSchema = Type.Object({ projectId: uuidSchema })

const artifactViewSchema = Type.Object({
  id: uuidSchema,
  artifactType: Type.String(),
  versionLabel: Type.String(),
  accessUrl: Type.String(),
  source: Type.String(),
  collectedAt: Type.String(),
  status: Type.String(),
  note: Type.Union([Type.String(), Type.Null()]),
})
const targetViewSchema = Type.Object({
  id: uuidSchema,
  targetType: Type.String(),
  targetId: uuidSchema,
  title: Type.String(),
  number: Type.Integer(),
})
const correctionViewSchema = Type.Object({
  id: uuidSchema,
  reason: Type.String(),
  correctedByUserId: uuidSchema,
  correctedAt: Type.String(),
})
export const buildViewSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  serviceId: Type.Union([uuidSchema, Type.Null()]),
  environment: Type.Union([environmentSchema, Type.Null()]),
  buildKey: Type.String(),
  versionLabel: Type.String(),
  commitRef: Type.Union([Type.String(), Type.Null()]),
  source: Type.String(),
  sourceRunId: Type.Union([Type.String(), Type.Null()]),
  collectedAt: Type.String(),
  resultStatus: resultStatusSchema,
  note: Type.Union([Type.String(), Type.Null()]),
  artifacts: Type.Array(artifactViewSchema),
  targets: Type.Array(targetViewSchema),
  corrections: Type.Array(correctionViewSchema),
  version: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
export const buildListSchema = Type.Object({
  items: Type.Array(buildViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

export const buildResponseSchema = apiResponseSchema(buildViewSchema)
export const buildListResponseSchema = apiResponseSchema(buildListSchema)

export type ReportBuildBody = Static<typeof reportBuildBodySchema>
export type CorrectBuildBody = Static<typeof correctBuildBodySchema>
export type AddArtifactBody = Static<typeof addArtifactBodySchema>
export type LinkTargetBody = Static<typeof linkTargetBodySchema>
export type BuildListQuery = Static<typeof buildListQuerySchema>

const verificationStatusSchema = Type.Union([
  Type.Literal('confirmed'),
  Type.Literal('pending'),
  Type.Literal('unknown'),
])
const runVersionSourceSchema = Type.Union([Type.Literal('manual'), Type.Literal('deployment_receipt')])
const reviewTargetTypeSchema = Type.Union([Type.Literal('mini_program'), Type.Literal('mobile_app')])
const reviewStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('withdrawn'),
  Type.Literal('unknown'),
])
const releaseStatusSchema = Type.Union([
  Type.Literal('not_released'),
  Type.Literal('released'),
  Type.Literal('partially_released'),
  Type.Literal('unknown'),
])
const latestFlagSchema = Type.Optional(Type.String({ pattern: '^(true|false)$' }))

export const projectArtifactListQuerySchema = Type.Object({
  serviceId: Type.Optional(uuidSchema),
  environment: Type.Optional(environmentSchema),
  artifactType: Type.Optional(artifactTypeSchema),
  latest: latestFlagSchema,
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

export const projectServiceParamsSchema = Type.Object({ projectId: uuidSchema, serviceId: uuidSchema })
export const runVersionParamsSchema = Type.Object({
  projectId: uuidSchema,
  serviceId: uuidSchema,
  environment: environmentSchema,
})
export const runVersionHistoryQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const confirmRunVersionBodySchema = Type.Object(
  {
    versionLabel: Type.String({ minLength: 1, maxLength: 200 }),
    source: runVersionSourceSchema,
    evidenceUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    verificationStatus: verificationStatusSchema,
    reason: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    version: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
)

export const reviewParamsSchema = Type.Object({ reviewId: uuidSchema })
export const createReviewBodySchema = Type.Object(
  {
    targetType: reviewTargetTypeSchema,
    versionLabel: Type.String({ minLength: 1, maxLength: 200 }),
    reviewPlatform: Type.String({ minLength: 1, maxLength: 120 }),
    submittedAt: timestampSchema,
    serviceId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    note: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    evidenceUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
)
export const updateReviewBodySchema = Type.Object(
  {
    reviewStatus: reviewStatusSchema,
    reviewReason: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    reviewedAt: Type.Optional(Type.Union([timestampSchema, Type.Null()])),
    evidenceUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
)
export const reviewListQuerySchema = Type.Object({
  serviceId: Type.Optional(uuidSchema),
  targetType: Type.Optional(reviewTargetTypeSchema),
  reviewStatus: Type.Optional(reviewStatusSchema),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

export const createReleaseBodySchema = Type.Object(
  {
    reviewId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    serviceId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    versionLabel: Type.String({ minLength: 1, maxLength: 200 }),
    releaseStatus: releaseStatusSchema,
    releasedAt: Type.Optional(Type.Union([timestampSchema, Type.Null()])),
    scopeNote: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    evidenceUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    version: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
)
export const releaseListQuerySchema = Type.Object({
  serviceId: Type.Optional(uuidSchema),
  releaseStatus: Type.Optional(releaseStatusSchema),
  reviewId: Type.Optional(uuidSchema),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

const projectArtifactViewSchema = Type.Object({
  id: uuidSchema,
  buildId: uuidSchema,
  serviceId: Type.Union([uuidSchema, Type.Null()]),
  environment: Type.Union([environmentSchema, Type.Null()]),
  artifactType: Type.String(),
  versionLabel: Type.String(),
  accessUrl: Type.String(),
  source: Type.String(),
  collectedAt: Type.String(),
  status: Type.String(),
  note: Type.Union([Type.String(), Type.Null()]),
  isLatest: Type.Boolean(),
})
const runVersionViewSchema = Type.Object({
  serviceId: uuidSchema,
  environment: environmentSchema,
  versionLabel: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([runVersionSourceSchema, Type.Null()]),
  evidenceUrl: Type.Union([Type.String(), Type.Null()]),
  verificationStatus: verificationStatusSchema,
  confirmedBy: Type.Union([uuidSchema, Type.Null()]),
  confirmedAt: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer(),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
})
const runVersionChangeViewSchema = Type.Object({
  id: uuidSchema,
  previousVersionLabel: Type.Union([Type.String(), Type.Null()]),
  newVersionLabel: Type.Union([Type.String(), Type.Null()]),
  previousStatus: verificationStatusSchema,
  newStatus: verificationStatusSchema,
  source: runVersionSourceSchema,
  evidenceUrl: Type.Union([Type.String(), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
  changedBy: uuidSchema,
  changedAt: Type.String(),
})
const reviewViewSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  serviceId: Type.Union([uuidSchema, Type.Null()]),
  targetType: reviewTargetTypeSchema,
  versionLabel: Type.String(),
  reviewPlatform: Type.String(),
  submittedAt: Type.String(),
  submittedBy: uuidSchema,
  note: Type.Union([Type.String(), Type.Null()]),
  evidenceUrl: Type.Union([Type.String(), Type.Null()]),
  reviewStatus: reviewStatusSchema,
  reviewReason: Type.Union([Type.String(), Type.Null()]),
  reviewedAt: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
const releaseViewSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  reviewId: Type.Union([uuidSchema, Type.Null()]),
  serviceId: Type.Union([uuidSchema, Type.Null()]),
  versionLabel: Type.String(),
  releaseStatus: releaseStatusSchema,
  releasedAt: Type.Union([Type.String(), Type.Null()]),
  scopeNote: Type.Union([Type.String(), Type.Null()]),
  evidenceUrl: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer(),
  recordedBy: uuidSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

export const projectArtifactListSchema = Type.Object({
  items: Type.Array(projectArtifactViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})
export const runVersionListSchema = Type.Object({
  items: Type.Array(runVersionViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})
export const runVersionHistoryListSchema = Type.Object({
  items: Type.Array(runVersionChangeViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})
export const reviewListSchema = Type.Object({
  items: Type.Array(reviewViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})
export const releaseListSchema = Type.Object({
  items: Type.Array(releaseViewSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})

export const projectArtifactListResponseSchema = apiResponseSchema(projectArtifactListSchema)
export const runVersionListResponseSchema = apiResponseSchema(runVersionListSchema)
export const runVersionViewResponseSchema = apiResponseSchema(runVersionViewSchema)
export const runVersionHistoryResponseSchema = apiResponseSchema(runVersionHistoryListSchema)
export const reviewViewResponseSchema = apiResponseSchema(reviewViewSchema)
export const reviewListResponseSchema = apiResponseSchema(reviewListSchema)
export const releaseViewResponseSchema = apiResponseSchema(releaseViewSchema)
export const releaseListResponseSchema = apiResponseSchema(releaseListSchema)

export type ProjectArtifactListQuery = Static<typeof projectArtifactListQuerySchema>
export type ConfirmRunVersionBody = Static<typeof confirmRunVersionBodySchema>
export type CreateReviewBody = Static<typeof createReviewBodySchema>
export type UpdateReviewBody = Static<typeof updateReviewBodySchema>
export type ReviewListQuery = Static<typeof reviewListQuerySchema>
export type CreateReleaseBody = Static<typeof createReleaseBodySchema>
export type ReleaseListQuery = Static<typeof releaseListQuerySchema>
