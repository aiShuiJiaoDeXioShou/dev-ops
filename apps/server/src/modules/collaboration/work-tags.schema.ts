import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const id = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
export const workTagViewSchema = Type.Object({
  id,
  name: Type.String(),
  updatedAt: Type.String(),
})
export const workTagBody = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 40 }) },
  { additionalProperties: false },
)
export const workTagParams = Type.Object({ tagId: id })
export const workTagListQuery = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 40 })),
  cursor: Type.Optional(id),
})
export const workTagLinkBody = Type.Object(
  {
    targetKind: Type.Union([Type.Literal('conversation'), Type.Literal('task')]),
    targetId: id,
  },
  { additionalProperties: false },
)
export const workTagResponse = apiResponseSchema(workTagViewSchema)
export const workTagListResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(workTagViewSchema),
    nextCursor: Type.Union([id, Type.Null()]),
  }),
)
export const workTagMutationResponse = apiResponseSchema(Type.Object({ id }))

export type WorkTagView = Static<typeof workTagViewSchema>
export type WorkTagLinkInput = Static<typeof workTagLinkBody>
