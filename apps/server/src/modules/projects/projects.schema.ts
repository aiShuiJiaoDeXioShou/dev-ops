import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const projectSchema = Type.Object({
  id: uuidSchema,
  teamId: uuidSchema,
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  owner: Type.Object({
    userId: uuidSchema,
    name: Type.String(),
    status: Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('missing')]),
    available: Type.Boolean(),
  }),
  status: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('ended')]),
  counts: Type.Object({ openRequirements: Type.Integer(), openBugs: Type.Integer() }),
  version: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
const projectListSchema = Type.Object({
  items: Type.Array(projectSchema),
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
})
const statsSchema = Type.Object({ openRequirements: Type.Integer(), openBugs: Type.Integer() })

export const projectListQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('ended')])),
  ownerUnavailable: Type.Optional(Type.Boolean()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const projectParamsSchema = Type.Object({ projectId: uuidSchema })
export const projectTeamParamsSchema = Type.Object({ teamId: uuidSchema })
export const createProjectBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    ownerUserId: Type.Optional(uuidSchema),
  },
  { additionalProperties: false },
)
export const updateProjectBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    ownerUserId: Type.Optional(uuidSchema),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('ended')])),
    statusReason: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  },
  { additionalProperties: false },
)

export const projectListResponseSchema = apiResponseSchema(projectListSchema)
export const projectResponseSchema = apiResponseSchema(projectSchema)
export const projectStatsResponseSchema = apiResponseSchema(statsSchema)

export type CreateProjectBody = Static<typeof createProjectBodySchema>
export type UpdateProjectBody = Static<typeof updateProjectBodySchema>

const serviceRepositorySchema = Type.Object({
  repositoryId: uuidSchema,
  name: Type.String(),
  namespace: Type.String(),
  provider: Type.String(),
  status: Type.String(),
})
const serviceSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([Type.Literal('active'), Type.Literal('disabled')]),
  repositories: Type.Array(serviceRepositorySchema),
  latestBuild: Type.Union([
    Type.Object({
      id: uuidSchema,
      versionLabel: Type.String(),
      collectedAt: Type.String(),
      resultStatus: Type.String(),
    }),
    Type.Null(),
  ]),
  runVersions: Type.Array(
    Type.Object({
      environment: Type.String(),
      versionLabel: Type.Union([Type.String(), Type.Null()]),
      verificationStatus: Type.String(),
      confirmedAt: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  version: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
export const serviceListResponseSchema = apiResponseSchema(Type.Array(serviceSchema))
export const serviceResponseSchema = apiResponseSchema(serviceSchema)
export const serviceParamsSchema = Type.Object({ projectId: uuidSchema, serviceId: uuidSchema })
export const serviceRepositoryParamsSchema = Type.Object({
  projectId: uuidSchema,
  serviceId: uuidSchema,
  repositoryId: uuidSchema,
})
export const createServiceBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    repositoryIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 20 })),
  },
  { additionalProperties: false },
)
export const updateServiceBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('disabled')])),
  },
  { additionalProperties: false },
)
export const addServiceRepositoryBodySchema = Type.Object({ repositoryId: uuidSchema }, { additionalProperties: false })
export const removeServiceRepositoryBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false },
)
