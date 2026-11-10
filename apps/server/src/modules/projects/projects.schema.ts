import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const projectSchema = Type.Object({
  id: uuidSchema,
  teamId: uuidSchema,
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  owner: Type.Object({ userId: uuidSchema, name: Type.String() }),
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
