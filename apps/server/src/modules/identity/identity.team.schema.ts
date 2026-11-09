import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.js'

const roleSchema = Type.Union([Type.Literal('admin'), Type.Literal('developer'), Type.Literal('viewer')])
const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })

const teamSchema = Type.Object({ id: uuidSchema, name: Type.String() })
const invitationSchema = Type.Object({
  id: uuidSchema,
  teamId: uuidSchema,
  email: Type.String(),
  role: roleSchema,
  status: Type.String(),
  expiresAt: Type.String(),
  invitedByUserId: uuidSchema,
  deliveryStatus: Type.String(),
  createdAt: Type.String(),
})
const memberSchema = Type.Object({
  userId: uuidSchema,
  name: Type.String(),
  email: Type.String(),
  role: roleSchema,
  status: Type.String(),
  joinedAt: Type.String(),
})
const teamSummarySchema = Type.Object({
  id: uuidSchema,
  name: Type.String(),
  role: roleSchema,
  status: Type.String(),
})
const invitationPublicSchema = Type.Object({
  teamName: Type.String(),
  email: Type.String(),
  role: roleSchema,
  expiresAt: Type.String(),
})
const acceptResultSchema = Type.Object({
  userId: uuidSchema,
  teamId: uuidSchema,
  teamName: Type.String(),
  role: roleSchema,
})

export const createTeamBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    adminEmail: Type.String({ minLength: 3, maxLength: 320 }),
  },
  { additionalProperties: false },
)
export const createTeamResponseSchema = apiResponseSchema(
  Type.Object({
    team: teamSchema,
    invitation: invitationSchema,
  }),
)

export const inviteMemberBodySchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320 }),
    role: roleSchema,
  },
  { additionalProperties: false },
)
export const invitationResponseSchema = apiResponseSchema(invitationSchema)
export const invitationListResponseSchema = apiResponseSchema(Type.Array(invitationSchema))
export const memberListResponseSchema = apiResponseSchema(Type.Array(memberSchema))
export const memberResponseSchema = apiResponseSchema(memberSchema)
export const memberUpdateBodySchema = Type.Object(
  {
    role: Type.Optional(roleSchema),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('disabled')])),
  },
  { additionalProperties: false },
)
export const teamSummaryListResponseSchema = apiResponseSchema(Type.Array(teamSummarySchema))
export const invitationPublicResponseSchema = apiResponseSchema(invitationPublicSchema)
export const acceptInvitationBodySchema = Type.Object(
  {
    password: Type.String({ minLength: 8, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
)
export const acceptInvitationResponseSchema = apiResponseSchema(acceptResultSchema)
export const teamParamsSchema = Type.Object({ teamId: uuidSchema })
export const memberParamsSchema = Type.Object({ teamId: uuidSchema, userId: uuidSchema })
export const invitationParamsSchema = Type.Object({ teamId: uuidSchema, invitationId: uuidSchema })
export const tokenParamsSchema = Type.Object({ token: Type.String({ minLength: 1, maxLength: 200 }) })
export const invitationQuerySchema = Type.Object({ status: Type.Optional(Type.String({ maxLength: 20 })) })

export type CreateTeamBody = Static<typeof createTeamBodySchema>
export type InviteMemberBody = Static<typeof inviteMemberBodySchema>
export type MemberUpdateBody = Static<typeof memberUpdateBodySchema>
export type AcceptInvitationBody = Static<typeof acceptInvitationBodySchema>
