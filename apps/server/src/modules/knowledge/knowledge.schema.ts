import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'
import { SKILL_CATEGORIES } from './knowledge.types.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const versionSchema = Type.Integer({ minimum: 1 })
const categorySchema = Type.Union([Type.Literal('product'), Type.Literal('engineering'), Type.Literal('delivery')])
const activitySchema = Type.Object({
  id: uuidSchema,
  action: Type.String(),
  actorUserId: uuidSchema,
  viaBotId: Type.Optional(uuidSchema),
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

const skillListItemSchema = Type.Object({
  id: uuidSchema,
  name: Type.String(),
  identifier: Type.String(),
  category: categorySchema,
  contentVersion: Type.String(),
  summary: Type.String(),
  source: Type.Union([Type.Literal('team'), Type.Literal('platform')]),
  conflictsWithPlatform: Type.Optional(Type.Boolean()),
  content: Type.Optional(Type.String()),
  enabled: Type.Boolean(),
  version: versionSchema,
  updatedAt: Type.String(),
})
const skillFileInputSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 200 }),
  content: Type.String({ minLength: 1, maxLength: 300000 }),
  encoding: Type.Union([Type.Literal('utf8'), Type.Literal('base64')]),
})
const skillFileSchema = Type.Object({
  path: Type.String(),
  content: Type.String(),
  encoding: Type.Union([Type.Literal('utf8'), Type.Literal('base64')]),
  sizeBytes: Type.Integer({ minimum: 0 }),
})
const skillDetailSchema = Type.Object({
  ...skillListItemSchema.properties,
  teamId: uuidSchema,
  content: Type.String(),
  files: Type.Array(skillFileSchema),
  createdByUserId: uuidSchema,
  createdAt: Type.String(),
})
const skillVersionItemSchema = Type.Object({
  id: uuidSchema,
  contentVersion: Type.String(),
  createdByUserId: uuidSchema,
  createdAt: Type.String(),
})
const skillVersionDetailSchema = Type.Object({
  ...skillVersionItemSchema.properties,
  content: Type.String(),
  files: Type.Array(skillFileSchema),
})
const skillPageSchema = Type.Object({ items: Type.Array(skillListItemSchema), ...pageMeta })
const skillVersionPageSchema = Type.Object({ items: Type.Array(skillVersionItemSchema), ...pageMeta })
const activityPageSchema = Type.Object({ items: Type.Array(activitySchema), ...pageMeta })

export const teamParamsSchema = Type.Object({ teamId: uuidSchema })
export const skillParamsSchema = Type.Object({ skillId: uuidSchema })
export const skillVersionParamsSchema = Type.Object({ skillId: uuidSchema, skillVersionId: uuidSchema })

export const pageQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const skillListQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  category: Type.Optional(categorySchema),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const createSkillBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 30 }),
    identifier: Type.String({ minLength: 2, maxLength: 40 }),
    category: categorySchema,
    contentVersion: Type.String({ minLength: 1, maxLength: 20 }),
    summary: Type.String({ minLength: 1, maxLength: 100 }),
    content: Type.String({ minLength: 1, maxLength: 50000 }),
    files: Type.Optional(Type.Array(skillFileInputSchema, { maxItems: 50 })),
  },
  { additionalProperties: false },
)
export const updateSkillBodySchema = Type.Object(
  {
    version: versionSchema,
    name: Type.String({ minLength: 1, maxLength: 30 }),
    category: categorySchema,
    contentVersion: Type.String({ minLength: 1, maxLength: 20 }),
    summary: Type.String({ minLength: 1, maxLength: 100 }),
    content: Type.String({ minLength: 1, maxLength: 50000 }),
    files: Type.Optional(Type.Array(skillFileInputSchema, { maxItems: 50 })),
  },
  { additionalProperties: false },
)
export const skillStateBodySchema = Type.Object({ version: versionSchema }, { additionalProperties: false })

export const skillPageResponseSchema = apiResponseSchema(skillPageSchema)
export const skillDetailResponseSchema = apiResponseSchema(skillDetailSchema)
export const skillVersionPageResponseSchema = apiResponseSchema(skillVersionPageSchema)
export const skillVersionDetailResponseSchema = apiResponseSchema(skillVersionDetailSchema)
export const activityPageResponseSchema = apiResponseSchema(activityPageSchema)

/** 分类枚举在 OpenAPI 中的可用值，供文档展示。 */
export const skillCategoryValues = SKILL_CATEGORIES
