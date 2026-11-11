import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const timestampSchema = Type.String()

const capabilitySchema = Type.Union([
  Type.Literal('code_change'),
  Type.Literal('create_pull_request'),
  Type.Literal('create_issue'),
  Type.Literal('add_comment'),
])

const userRefSchema = Type.Object({
  userId: uuidSchema,
  name: Type.String(),
})

/** 项目路径参数。 */
export const toolProjectParamsSchema = Type.Object({ projectId: uuidSchema })
/** 代码变更路径参数。 */
export const toolCodeChangeParamsSchema = Type.Object({ codeChangeId: uuidSchema })
/** 授权路径参数。 */
export const toolGrantParamsSchema = Type.Object({ projectId: uuidSchema, grantId: uuidSchema })

/** 能力状态响应。 */
export const toolCapabilitiesResponseSchema = apiResponseSchema(
  Type.Object({
    capabilities: Type.Array(Type.Object({ capability: capabilitySchema, granted: Type.Boolean() })),
    canManageGrants: Type.Boolean(),
  }),
)

const grantViewSchema = Type.Object({
  id: uuidSchema,
  user: userRefSchema,
  capability: capabilitySchema,
  grantedBy: userRefSchema,
  grantedAt: timestampSchema,
  revokedAt: Type.Union([timestampSchema, Type.Null()]),
})

/** 授权列表响应。 */
export const toolGrantListResponseSchema = apiResponseSchema(Type.Object({ items: Type.Array(grantViewSchema) }))

/** 授权请求体。 */
export const toolGrantBodySchema = Type.Object(
  { userId: uuidSchema, capability: capabilitySchema },
  { additionalProperties: false },
)

/** 授权响应。 */
export const toolGrantResponseSchema = apiResponseSchema(Type.Object({ grant: grantViewSchema }))

/** 撤销授权请求体。 */
export const toolGrantRevokeBodySchema = Type.Object(
  { reason: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
  { additionalProperties: false },
)

/** 撤销授权响应。 */
export const toolGrantRevokeResponseSchema = apiResponseSchema(Type.Object({ id: uuidSchema, revoked: Type.Boolean() }))

const codeChangeViewSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  repository: Type.Object({ id: uuidSchema, name: Type.Union([Type.String(), Type.Null()]) }),
  baseRef: Type.String(),
  baseSha: Type.String(),
  branchName: Type.String(),
  commitMessage: Type.String(),
  patchSha256: Type.String(),
  patchSizeBytes: Type.Integer(),
  validationWorkflowPath: Type.String(),
  status: Type.String(),
  pipelineRunId: Type.Union([uuidSchema, Type.Null()]),
  validation: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  pullRequest: Type.Union([
    Type.Object({
      number: Type.Union([Type.Integer(), Type.Null()]),
      url: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Null(),
  ]),
  diff: Type.Union([
    Type.Object({
      sha256: Type.Union([Type.String(), Type.Null()]),
      sizeBytes: Type.Union([Type.Integer(), Type.Null()]),
      truncated: Type.Boolean(),
    }),
    Type.Null(),
  ]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.Union([userRefSchema, Type.Null()]),
  createdAt: timestampSchema,
  finishedAt: Type.Union([timestampSchema, Type.Null()]),
})

/** 创建代码变更请求体。 */
export const createCodeChangeBodySchema = Type.Object(
  {
    repositoryId: uuidSchema,
    baseRef: Type.String(),
    branchName: Type.String(),
    commitMessage: Type.String(),
    patch: Type.String(),
    patchSha256: Type.String(),
    validationWorkflowPath: Type.String(),
    secretEnvironment: Type.Optional(
      Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')]),
    ),
  },
  { additionalProperties: false },
)

/** 创建代码变更响应。 */
export const createCodeChangeResponseSchema = apiResponseSchema(
  Type.Object({ codeChange: codeChangeViewSchema, invocationId: uuidSchema }),
)

/** 代码变更列表响应。 */
export const codeChangeListResponseSchema = apiResponseSchema(Type.Object({ items: Type.Array(codeChangeViewSchema) }))

/** 代码变更详情响应。 */
export const codeChangeResponseSchema = apiResponseSchema(Type.Object({ codeChange: codeChangeViewSchema }))

/** 差异响应。 */
export const codeChangeDiffResponseSchema = apiResponseSchema(
  Type.Object({
    content: Type.String(),
    truncated: Type.Boolean(),
    sha256: Type.Union([Type.String(), Type.Null()]),
    sizeBytes: Type.Union([Type.Integer(), Type.Null()]),
  }),
)

/** 取消代码变更请求体。 */
export const cancelCodeChangeBodySchema = Type.Object(
  { reason: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
  { additionalProperties: false },
)

/** 取消代码变更响应。 */
export const cancelCodeChangeResponseSchema = apiResponseSchema(
  Type.Object({ id: uuidSchema, cancelled: Type.Boolean() }),
)

/** 创建 PR 请求体。 */
export const createPullRequestBodySchema = Type.Object(
  {
    title: Type.String(),
    body: Type.Optional(Type.String()),
    targetBranch: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

/** 创建 PR 响应。 */
export const createPullRequestResponseSchema = apiResponseSchema(
  Type.Object({
    invocationId: uuidSchema,
    pullRequest: Type.Object({
      number: Type.Integer(),
      url: Type.Union([Type.String(), Type.Null()]),
      sourceBranch: Type.String(),
      targetBranch: Type.String(),
    }),
  }),
)

/** 创建远端 Issue 请求体。 */
export const createRemoteIssueBodySchema = Type.Object(
  { repositoryId: uuidSchema, bugId: uuidSchema, title: Type.String(), body: Type.String() },
  { additionalProperties: false },
)

/** 创建远端 Issue 响应。 */
export const createRemoteIssueResponseSchema = apiResponseSchema(
  Type.Object({
    invocationId: uuidSchema,
    issue: Type.Object({ number: Type.Integer(), url: Type.Union([Type.String(), Type.Null()]) }),
  }),
)

/** 添加评论请求体。 */
export const addToolCommentBodySchema = Type.Object(
  {
    targetType: Type.Union([
      Type.Literal('requirement'),
      Type.Literal('bug'),
      Type.Literal('remote_issue'),
      Type.Literal('remote_pull_request'),
    ]),
    targetId: Type.Optional(uuidSchema),
    repositoryId: Type.Optional(uuidSchema),
    remoteNumber: Type.Optional(Type.Integer({ minimum: 1 })),
    body: Type.String(),
  },
  { additionalProperties: false },
)

/** 添加评论响应。 */
export const addToolCommentResponseSchema = apiResponseSchema(
  Type.Object({
    invocationId: uuidSchema,
    comment: Type.Object({
      id: Type.String(),
      url: Type.Union([Type.String(), Type.Null()]),
      createdAt: Type.String(),
    }),
  }),
)

const invocationViewSchema = Type.Object({
  id: uuidSchema,
  capability: capabilitySchema,
  channel: Type.Union([Type.Literal('web'), Type.Literal('cli')]),
  status: Type.String(),
  repositoryId: Type.Union([uuidSchema, Type.Null()]),
  targetRef: Type.Union([Type.String(), Type.Null()]),
  inputSummary: Type.Record(Type.String(), Type.Unknown()),
  resultRef: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
})

/** 调用记录列表响应。 */
export const toolInvocationListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(invocationViewSchema) }),
)
