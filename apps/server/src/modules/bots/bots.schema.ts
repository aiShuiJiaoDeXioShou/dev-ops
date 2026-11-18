import { Type, type Static } from 'typebox'
import { botSkillVersionSchema } from './bots.skills.ts'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const version = Type.Integer({ minimum: 1 })
const name = Type.String({ minLength: 1, maxLength: 60 })
const responsibility = Type.String({ minLength: 1, maxLength: 4_000 })
const instructions = Type.String({ maxLength: 16_000 })
const skillIds = Type.Array(uuid, { maxItems: 50, uniqueItems: true })
const dateTime = Type.String()
const nullableId = Type.Union([uuid, Type.Null()])
const accessMode = Type.Union([Type.Literal('sandbox'), Type.Literal('full')])
const modelBinding = Type.Object(
  { connectionId: uuid, modelId: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
)

export const botTeamParams = Type.Object({ teamId: uuid })
export const botParams = Type.Object({ botId: uuid })
export const botCursorQuery = Type.Object({ cursor: Type.Optional(uuid) }, { additionalProperties: false })
export const botListQuery = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 60 })),
    ownerUserId: Type.Optional(uuid),
    cursor: Type.Optional(uuid),
  },
  { additionalProperties: false },
)

export const createBotBody = Type.Object(
  {
    name,
    responsibility,
    ownerUserId: uuid,
    avatarKey: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    instructions: Type.Optional(instructions),
    skillIds: Type.Optional(skillIds),
    modelBinding: Type.Optional(modelBinding),
  },
  { additionalProperties: false },
)

export const updateBotBody = Type.Object(
  {
    configVersion: version,
    name,
    responsibility,
    ownerUserId: uuid,
    avatarKey: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 240 }), Type.Null()])),
    instructions: Type.Optional(instructions),
    skillIds: Type.Optional(skillIds),
  },
  { additionalProperties: false },
)

export const botVersionBody = Type.Object({ configVersion: version }, { additionalProperties: false })
export const botAccessBody = Type.Object({ configVersion: version, accessMode }, { additionalProperties: false })
export const bindBotModelBody = Type.Object(
  {
    configVersion: version,
    ...modelBinding.properties,
  },
  { additionalProperties: false },
)

const botAvailabilitySchema = Type.Union([
  Type.Literal('available'),
  Type.Literal('disabled'),
  Type.Literal('model_unbound'),
  Type.Literal('model_unavailable'),
  Type.Literal('worker_offline'),
])

const botViewSchema = Type.Object({
  id: uuid,
  teamId: uuid,
  name: Type.String(),
  responsibility: Type.String(),
  instructions: Type.String(),
  avatarKey: Type.Union([Type.String(), Type.Null()]),
  ownerUserId: uuid,
  ownerName: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([Type.Literal('enabled'), Type.Literal('disabled')]),
  availability: botAvailabilitySchema,
  configVersion: version,
  skillIds: Type.Array(uuid),
  modelConnectionId: nullableId,
  modelId: Type.Union([Type.String(), Type.Null()]),
  accessMode: Type.Optional(accessMode),
  connectionName: Type.Union([Type.String(), Type.Null()]),
  updatedAt: dateTime,
  lastActiveAt: Type.Union([dateTime, Type.Null()]),
})

const botRunSummarySchema = Type.Object({
  id: uuid,
  conversationId: uuid,
  status: Type.Union([
    Type.Literal('queued'),
    Type.Literal('running'),
    Type.Literal('succeeded'),
    Type.Literal('failed'),
    Type.Literal('stopped'),
  ]),
  skillVersions: Type.Union([Type.Array(botSkillVersionSchema), Type.Null()]),
  failureKind: Type.Union([Type.String(), Type.Null()]),
  failureMessage: Type.Union([Type.String(), Type.Null()]),
  turns: Type.Integer({ minimum: 0 }),
  createdAt: dateTime,
  finishedAt: Type.Union([dateTime, Type.Null()]),
})

export const botResponse = apiResponseSchema(botViewSchema)
export const botListResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(botViewSchema),
    nextCursor: nullableId,
  }),
)
export const botRunsResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(botRunSummarySchema),
    nextCursor: nullableId,
  }),
)

export type BotView = Static<typeof botViewSchema>
export type BotRunSummary = Static<typeof botRunSummarySchema>
export type CreateBotInput = Static<typeof createBotBody>
export type UpdateBotInput = Static<typeof updateBotBody>
export type BindBotModelInput = Static<typeof bindBotModelBody>
export type BotAccessInput = Static<typeof botAccessBody>
export type BotListFilters = Static<typeof botListQuery>
