import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const repositorySchema = Type.Object({
  id: uuidSchema,
  connectionId: uuidSchema,
  providerKey: Type.String(),
  namespace: Type.String(),
  name: Type.String(),
  webUrl: Type.String(),
  defaultBranch: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
})
const referenceSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  repositoryId: uuidSchema,
  targetType: Type.String(),
  targetId: uuidSchema,
  objectType: Type.String(),
  remoteId: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.String(), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  lastCheckStatus: Type.String(),
  lastErrorCode: Type.Union([Type.String(), Type.Null()]),
  lastCheckedAt: Type.Union([Type.String(), Type.Null()]),
})
const treeEntrySchema = Type.Object({
  path: Type.String(),
  type: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
  size: Type.Union([Type.Integer(), Type.Null()]),
})
const pageMeta = { page: Type.Integer(), pageSize: Type.Integer(), total: Type.Integer() }
export const projectParamsSchema = Type.Object({ projectId: uuidSchema })
export const projectRepositoryParamsSchema = Type.Object({ projectId: uuidSchema, repositoryId: uuidSchema })
export const codeReferenceParamsSchema = Type.Object({ codeReferenceId: uuidSchema })
export const repositoryQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const repositoryListResponseSchema = apiResponseSchema(Type.Array(repositorySchema))
export const repositoryTreeQuerySchema = Type.Object({ branch: Type.Optional(Type.String({ maxLength: 200 })) })
export const repositoryTreeResponseSchema = apiResponseSchema(
  Type.Object({ branch: Type.String(), entries: Type.Array(treeEntrySchema) }),
)
export const repositoryFileQuerySchema = Type.Object({
  branch: Type.Optional(Type.String({ maxLength: 200 })),
  path: Type.String({ minLength: 1, maxLength: 500 }),
})
export const repositoryFileResponseSchema = apiResponseSchema(
  Type.Object({
    branch: Type.String(),
    path: Type.String(),
    content: Type.String(),
    truncated: Type.Boolean(),
  }),
)
export const availableRepositoryListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(repositorySchema), ...pageMeta }),
)
export const linkRepositoryBodySchema = Type.Object({ repositoryId: uuidSchema }, { additionalProperties: false })
export const unlinkRepositoryBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
)
export const createReferenceBodySchema = Type.Object(
  {
    targetType: Type.Union([Type.Literal('requirement'), Type.Literal('bug')]),
    targetId: uuidSchema,
    repositoryId: uuidSchema,
    objectType: Type.Union([Type.Literal('commit'), Type.Literal('issue'), Type.Literal('change_request')]),
    remoteId: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
)
export const removeReferenceBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
)
export const codeReferenceResponseSchema = apiResponseSchema(referenceSchema)
export const removedResponseSchema = apiResponseSchema(Type.Object({ removed: Type.Boolean() }))
