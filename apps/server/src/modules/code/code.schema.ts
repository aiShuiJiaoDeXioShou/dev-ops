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
export const repositoryBranchesResponseSchema = apiResponseSchema(Type.Object({ branches: Type.Array(Type.String()) }))
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

// 分支、标签或提交标识的稳定字符集：必须由字母数字开头，避免把相对路径或命令行参数传入来源。
const refPattern = '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$'
const refSchema = Type.String({ minLength: 1, maxLength: 200, pattern: refPattern })
const pageQuery = {
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}
const commitStateSchema = Type.Union([
  Type.Literal('open'),
  Type.Literal('closed'),
  Type.Literal('merged'),
  Type.Literal('unknown'),
])
const reviewStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('changes_requested'),
  Type.Literal('unknown'),
])
const fileStatusSchema = Type.Union([
  Type.Literal('added'),
  Type.Literal('modified'),
  Type.Literal('removed'),
  Type.Literal('renamed'),
  Type.Literal('unknown'),
])
const commitSummarySchema = Type.Object({
  sha: Type.String(),
  title: Type.String(),
  authorName: Type.String(),
  committedAt: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  lastCheckedAt: Type.String(),
})
const commitFileSchema = Type.Object({
  path: Type.String(),
  status: fileStatusSchema,
  additions: Type.Integer(),
  deletions: Type.Integer(),
})
const commitDetailSchema = Type.Object({
  ...commitSummarySchema.properties,
  files: Type.Array(commitFileSchema),
  filesTruncated: Type.Boolean(),
  filesUnsupported: Type.Boolean(),
})
const pullRequestFileSchema = Type.Object({
  path: Type.String(),
  status: fileStatusSchema,
  additions: Type.Integer(),
  deletions: Type.Integer(),
  patch: Type.Union([Type.String(), Type.Null()]),
  binary: Type.Boolean(),
  truncated: Type.Boolean(),
})
const pullRequestSchema = Type.Object({
  number: Type.Integer(),
  title: Type.String(),
  authorName: Type.String(),
  sourceBranch: Type.String(),
  targetBranch: Type.String(),
  state: commitStateSchema,
  reviewStatus: reviewStatusSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
  mergedAt: Type.Union([Type.String(), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  lastCheckedAt: Type.String(),
  files: Type.Array(pullRequestFileSchema),
  truncated: Type.Boolean(),
})
export const commitListQuerySchema = Type.Object({ ref: Type.Optional(refSchema), ...pageQuery })
export const pullRequestListQuerySchema = Type.Object({
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('all')])),
  author: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  linkedTargetId: Type.Optional(uuidSchema),
  ...pageQuery,
})
export const commitRefParamsSchema = Type.Object({
  projectId: uuidSchema,
  repositoryId: uuidSchema,
  ref: refSchema,
})
export const pullRequestParamsSchema = Type.Object({
  projectId: uuidSchema,
  repositoryId: uuidSchema,
  number: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
})
export const commitListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(commitSummarySchema), ...pageMeta }),
)
export const pullRequestListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(pullRequestSchema), ...pageMeta }),
)
export const commitResponseSchema = apiResponseSchema(commitDetailSchema)
export const pullRequestResponseSchema = apiResponseSchema(pullRequestSchema)
export const pullRequestDiffResponseSchema = apiResponseSchema(
  Type.Object({ patch: Type.String(), truncated: Type.Boolean() }),
)
