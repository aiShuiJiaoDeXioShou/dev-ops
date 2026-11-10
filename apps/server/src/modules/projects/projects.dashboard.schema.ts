import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const dateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

export const projectActivityQuerySchema = Type.Object({
  source: Type.Optional(
    Type.Union([Type.Literal('all'), Type.Literal('activity'), Type.Literal('code'), Type.Literal('pull_request')]),
  ),
  search: Type.Optional(Type.String({ maxLength: 200 })),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('ended')])),
  from: Type.Optional(dateSchema),
  to: Type.Optional(dateSchema),
})
export const projectActivityTeamParamsSchema = Type.Object({ teamId: uuidSchema })

const daySchema = Type.Object({
  date: Type.String(),
  total: Type.Integer(),
  counts: Type.Object({
    activity: Type.Integer(),
    code: Type.Integer(),
    pullRequest: Type.Integer(),
  }),
})
const projectSchema = Type.Object({
  projectId: uuidSchema,
  status: Type.String(),
  owner: Type.Object({ userId: uuidSchema, name: Type.String(), available: Type.Boolean() }),
  items: Type.Object({ total: Type.Integer(), completed: Type.Integer() }),
  pendingRequirements: Type.Integer(),
  pendingBugs: Type.Integer(),
  pendingPullRequests: Type.Union([Type.Integer(), Type.Null()]),
  bots: Type.Null(),
})
const resultSchema = Type.Object({
  timezone: Type.Literal('UTC'),
  from: Type.String(),
  to: Type.String(),
  source: Type.String(),
  sourceStatus: Type.Object({ activity: Type.String(), code: Type.String(), pullRequest: Type.String() }),
  days: Type.Array(daySchema),
  projects: Type.Array(projectSchema),
})

export const projectActivityResponseSchema = apiResponseSchema(resultSchema)
