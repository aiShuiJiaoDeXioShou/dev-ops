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
  source: Type.Literal('team'),
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
const templateListItemSchema = Type.Object({
  id: uuidSchema,
  name: Type.String(),
  tag: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  excerpt: Type.String(),
  contentVersion: Type.Integer({ minimum: 1 }),
  version: versionSchema,
  updatedAt: Type.String(),
})
const templateDetailSchema = Type.Object({
  ...templateListItemSchema.properties,
  teamId: uuidSchema,
  content: Type.String(),
  createdByUserId: uuidSchema,
  createdAt: Type.String(),
})
const templateVersionItemSchema = Type.Object({
  id: uuidSchema,
  contentVersion: Type.Integer({ minimum: 1 }),
  createdByUserId: uuidSchema,
  createdAt: Type.String(),
})
const templateVersionDetailSchema = Type.Object({
  ...templateVersionItemSchema.properties,
  content: Type.String(),
})
const projectTemplateSelectionSchema = Type.Object({
  selection: Type.Union([
    Type.Object({
      templateId: uuidSchema,
      templateName: Type.String(),
      contentVersion: Type.Integer({ minimum: 1 }),
      selectedByUserId: uuidSchema,
      updatedAt: Type.String(),
    }),
    Type.Null(),
  ]),
  version: Type.Integer({ minimum: 0 }),
})
const snapshotLinkCreatedSchema = Type.Object({
  token: Type.String(),
  templateId: uuidSchema,
  contentVersion: Type.Integer({ minimum: 1 }),
  createdAt: Type.String(),
})
const templateSnapshotSchema = Type.Object({
  templateId: uuidSchema,
  templateName: Type.String(),
  tag: Type.String(),
  contentVersion: Type.Integer({ minimum: 1 }),
  content: Type.String(),
  createdAt: Type.String(),
})
const skillPageSchema = Type.Object({ items: Type.Array(skillListItemSchema), ...pageMeta })
const skillVersionPageSchema = Type.Object({ items: Type.Array(skillVersionItemSchema), ...pageMeta })
const templatePageSchema = Type.Object({ items: Type.Array(templateListItemSchema), ...pageMeta })
const templateVersionPageSchema = Type.Object({ items: Type.Array(templateVersionItemSchema), ...pageMeta })
const activityPageSchema = Type.Object({ items: Type.Array(activitySchema), ...pageMeta })

export const teamParamsSchema = Type.Object({ teamId: uuidSchema })
export const skillParamsSchema = Type.Object({ skillId: uuidSchema })
export const skillVersionParamsSchema = Type.Object({ skillId: uuidSchema, skillVersionId: uuidSchema })
export const templateParamsSchema = Type.Object({ templateId: uuidSchema })
export const templateVersionParamsSchema = Type.Object({ templateId: uuidSchema, templateVersionId: uuidSchema })
export const projectParamsSchema = Type.Object({ projectId: uuidSchema })
export const snapshotTokenParamsSchema = Type.Object({ token: Type.String({ minLength: 1, maxLength: 64 }) })

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
export const templateListQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  tag: Type.Optional(Type.String({ maxLength: 30 })),
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

export const createTemplateBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 40 }),
    tag: Type.String({ minLength: 1, maxLength: 30 }),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
    content: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
)
export const updateTemplateBodySchema = Type.Object(
  {
    version: versionSchema,
    name: Type.String({ minLength: 1, maxLength: 40 }),
    tag: Type.String({ minLength: 1, maxLength: 30 }),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
    content: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
)
export const duplicateTemplateBodySchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 40 }) },
  { additionalProperties: false },
)

export const applyProjectTemplateBodySchema = Type.Object(
  {
    templateId: uuidSchema,
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export const clearProjectTemplateBodySchema = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)

export const skillPageResponseSchema = apiResponseSchema(skillPageSchema)
export const skillDetailResponseSchema = apiResponseSchema(skillDetailSchema)
export const skillVersionPageResponseSchema = apiResponseSchema(skillVersionPageSchema)
export const skillVersionDetailResponseSchema = apiResponseSchema(skillVersionDetailSchema)
export const templatePageResponseSchema = apiResponseSchema(templatePageSchema)
export const templateDetailResponseSchema = apiResponseSchema(templateDetailSchema)
export const templateVersionPageResponseSchema = apiResponseSchema(templateVersionPageSchema)
export const templateVersionDetailResponseSchema = apiResponseSchema(templateVersionDetailSchema)
export const projectTemplateSelectionResponseSchema = apiResponseSchema(projectTemplateSelectionSchema)
export const snapshotLinkCreatedResponseSchema = apiResponseSchema(snapshotLinkCreatedSchema)
export const templateSnapshotResponseSchema = apiResponseSchema(templateSnapshotSchema)
export const activityPageResponseSchema = apiResponseSchema(activityPageSchema)

/** 分类枚举在 OpenAPI 中的可用值，供文档展示。 */
export const skillCategoryValues = SKILL_CATEGORIES
