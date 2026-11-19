import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const id = Type.String({ pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' })
const scope = Type.Union([Type.Literal('user'), Type.Literal('bot')])
const content = Type.String({ minLength: 1, maxLength: 2000 })
const memory = Type.Object({
  id,
  botId: id,
  botName: Type.String(),
  scope,
  content: Type.String(),
  essential: Type.Boolean(),
  source: Type.Optional(
    Type.Object({
      kind: Type.Union([Type.Literal('conversation'), Type.Literal('consolidation')]),
      detail: Type.Optional(
        Type.Object({
          from: Type.String(),
          to: Type.String(),
          mergedMemoryIds: Type.Array(id),
          conversationCount: Type.Integer({ minimum: 0 }),
        }),
      ),
    }),
  ),
  sourceUserName: Type.Union([Type.String(), Type.Null()]),
  sourceConversationId: Type.Union([id, Type.Null()]),
  sourceConversationName: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
  canEdit: Type.Boolean(),
  canRemove: Type.Boolean(),
})
export const botMemoryParams = Type.Object({ memoryId: id })
export const botMemoryQuery = Type.Object(
  {
    botId: Type.Optional(id),
    scope: Type.Optional(scope),
    query: Type.Optional(Type.String({ maxLength: 200 })),
    cursor: Type.Optional(id),
  },
  { additionalProperties: false },
)
export const botMemoryCreateBody = Type.Object(
  { botId: id, scope, content, essential: Type.Boolean() },
  { additionalProperties: false },
)
export const botMemoryUpdateBody = Type.Object(
  { content: Type.Optional(content), essential: Type.Optional(Type.Boolean()) },
  { additionalProperties: false, minProperties: 1 },
)
export const botMemoryResponse = apiResponseSchema(memory)
export const botMemoryListResponse = apiResponseSchema(
  Type.Object({ items: Type.Array(memory), nextCursor: Type.Union([id, Type.Null()]) }),
)
export const botMemoryRemoveResponse = apiResponseSchema(botMemoryParams)

export type BotMemoryView = Static<typeof memory>
export type BotMemoryFilters = Static<typeof botMemoryQuery>
export type BotMemoryCreateInput = Static<typeof botMemoryCreateBody>
export type BotMemoryUpdateInput = Static<typeof botMemoryUpdateBody>
