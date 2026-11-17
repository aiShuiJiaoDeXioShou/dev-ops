import { Type, type Static } from 'typebox'

const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const name = Type.String({ minLength: 1, maxLength: 80 })
const responsibility = Type.String({ maxLength: 2000 })
const instructions = Type.String({ maxLength: 8000 })

export const createBotGroupBody = Type.Object(
  {
    kind: Type.Literal('group'),
    name,
    leaderBotId: uuid,
    botIds: Type.Array(uuid, { minItems: 1, maxItems: 50, uniqueItems: true }),
    memberUserIds: Type.Array(uuid, { maxItems: 100, uniqueItems: true }),
    responsibility: Type.Optional(responsibility),
    instructions: Type.Optional(instructions),
  },
  { additionalProperties: false },
)
export const updateBotGroupBody = Type.Object(
  {
    name: Type.Optional(name),
    leaderBotId: Type.Optional(uuid),
    responsibility: Type.Optional(responsibility),
    instructions: Type.Optional(instructions),
  },
  { additionalProperties: false, minProperties: 1 },
)
export const botGroupMemberBody = Type.Object(
  {
    kind: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
    memberId: uuid,
  },
  { additionalProperties: false },
)

export type CreateBotGroupInput = Static<typeof createBotGroupBody>
export type UpdateBotGroupInput = Static<typeof updateBotGroupBody>
export type BotGroupMemberInput = Static<typeof botGroupMemberBody>
