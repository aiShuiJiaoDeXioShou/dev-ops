import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const timestampSchema = Type.String()
const environmentSchema = Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')])
const operationKindSchema = Type.Union([
  Type.Literal('deploy_version'),
  Type.Literal('database_change'),
  Type.Literal('server_cleanup'),
  Type.Literal('cloud_resource_change'),
])
const executionModeSchema = Type.Union([Type.Literal('platform_pipeline'), Type.Literal('external_system')])

/** 项目路径参数。 */
export const changePlanProjectParamsSchema = Type.Object({ projectId: uuidSchema })
/** 计划路径参数。 */
export const changePlanParamsSchema = Type.Object({ planId: uuidSchema })
/** 团队路径参数。 */
export const changePlanTeamParamsSchema = Type.Object({ teamId: uuidSchema })

const ownerRefSchema = Type.Object({
  userId: uuidSchema,
  name: Type.String(),
  status: Type.String(),
  available: Type.Boolean(),
})

const planViewSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  serviceId: Type.Union([uuidSchema, Type.Null()]),
  targetResource: Type.String(),
  environment: Type.String(),
  operationKind: Type.String(),
  status: Type.String(),
  revision: Type.Integer(),
  versionLabel: Type.String(),
  scopeSummary: Type.String(),
  evidence: Type.String(),
  rollbackPlan: Type.String(),
  executionMode: Type.String(),
  workflowPath: Type.Union([Type.String(), Type.Null()]),
  workflowRef: Type.Union([Type.String(), Type.Null()]),
  approvedBy: Type.Union([ownerRefSchema, Type.Null()]),
  approvedAt: Type.Union([timestampSchema, Type.Null()]),
  approvedRevision: Type.Union([Type.Integer(), Type.Null()]),
  activeExecutionId: Type.Union([uuidSchema, Type.Null()]),
  startedAt: Type.Union([timestampSchema, Type.Null()]),
  completedAt: Type.Union([timestampSchema, Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.Union([ownerRefSchema, Type.Null()]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: Type.Integer(),
})

const eventViewSchema = Type.Object({
  id: uuidSchema,
  eventType: Type.String(),
  actor: Type.Union([ownerRefSchema, Type.Null()]),
  summary: Type.String(),
  payload: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: timestampSchema,
})

const executionViewSchema = Type.Object({
  id: uuidSchema,
  attempt: Type.Integer(),
  planRevision: Type.Integer(),
  status: Type.String(),
  pipelineRunId: Type.Union([uuidSchema, Type.Null()]),
  startedAt: Type.Union([timestampSchema, Type.Null()]),
  finishedAt: Type.Union([timestampSchema, Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  verificationStatus: Type.String(),
  verificationEvidence: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  healthStatus: Type.Union([Type.String(), Type.Null()]),
  expectedVersionLabel: Type.String(),
  actualVersionLabel: Type.Union([Type.String(), Type.Null()]),
  verifiedBy: Type.Union([ownerRefSchema, Type.Null()]),
  verifiedAt: Type.Union([timestampSchema, Type.Null()]),
  verificationNote: Type.Union([Type.String(), Type.Null()]),
})

const actionsSchema = Type.Object({
  canUpdate: Type.Boolean(),
  canApprove: Type.Boolean(),
  canExecute: Type.Boolean(),
  canVerify: Type.Boolean(),
  canCancel: Type.Boolean(),
  canRetry: Type.Boolean(),
})

/** 创建计划请求体。 */
export const createChangePlanBodySchema = Type.Object(
  {
    operationKind: operationKindSchema,
    environment: environmentSchema,
    serviceId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    targetResource: Type.String(),
    versionLabel: Type.String(),
    scopeSummary: Type.String(),
    evidence: Type.String(),
    rollbackPlan: Type.String(),
    executionMode: executionModeSchema,
    workflowPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    workflowRef: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
)

/** 修改计划请求体。 */
export const updateChangePlanBodySchema = Type.Object(
  {
    operationKind: operationKindSchema,
    environment: environmentSchema,
    serviceId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
    targetResource: Type.String(),
    versionLabel: Type.String(),
    scopeSummary: Type.String(),
    evidence: Type.String(),
    rollbackPlan: Type.String(),
    executionMode: executionModeSchema,
    workflowPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    workflowRef: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    expectedVersion: Type.Integer({ minimum: 1 }),
    expectedRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
)

/** 放行请求体。 */
export const approveChangePlanBodySchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
)

/** 取消请求体。 */
export const cancelChangePlanBodySchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    reason: Type.String(),
  },
  { additionalProperties: false },
)

/** 列表查询。 */
export const changePlanListQuerySchema = Type.Object(
  {
    projectId: Type.Optional(uuidSchema),
    environment: Type.Optional(environmentSchema),
    status: Type.Optional(
      Type.Union([
        Type.Literal('pending'),
        Type.Literal('approved'),
        Type.Literal('executing'),
        Type.Literal('verifying'),
        Type.Literal('completed'),
        Type.Literal('failed'),
        Type.Literal('cancelled'),
      ]),
    ),
    operationKind: Type.Optional(operationKindSchema),
    from: Type.Optional(timestampSchema),
    to: Type.Optional(timestampSchema),
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
)

/** 计划详情响应。 */
export const changePlanDetailResponseSchema = apiResponseSchema(
  Type.Object({
    plan: planViewSchema,
    approval: Type.Union([
      Type.Object({
        id: uuidSchema,
        revision: Type.Integer(),
        approvedBy: Type.Union([ownerRefSchema, Type.Null()]),
        approvedAt: timestampSchema,
        invalidatedAt: Type.Union([timestampSchema, Type.Null()]),
      }),
      Type.Null(),
    ]),
    executions: Type.Array(executionViewSchema),
    events: Type.Array(eventViewSchema),
    actions: actionsSchema,
  }),
)

/** 计划列表响应。 */
export const changePlanListResponseSchema = apiResponseSchema(
  Type.Object({
    items: Type.Array(planViewSchema),
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
  }),
)

/** 取消计划响应。 */
export const cancelChangePlanResponseSchema = apiResponseSchema(
  Type.Object({
    plan: planViewSchema,
    externalEffect: Type.Union([Type.Literal('none'), Type.Literal('partial'), Type.Literal('unknown')]),
  }),
)

/** 执行请求体。 */
export const executeChangePlanBodySchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)

/** 验证请求体；产物缺失时必须带人工核对字段。 */
export const verifyChangePlanBodySchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    actualVersionLabel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    healthStatus: Type.Optional(
      Type.Union([Type.Literal('ok'), Type.Literal('failing'), Type.Literal('unknown'), Type.Null()]),
    ),
  },
  { additionalProperties: false },
)

/** 执行结果响应。 */
export const executeChangePlanResponseSchema = apiResponseSchema(
  Type.Object({ plan: planViewSchema, execution: executionViewSchema }),
)

/** 验证结果响应。 */
export const verifyChangePlanResponseSchema = apiResponseSchema(
  Type.Object({
    plan: planViewSchema,
    execution: executionViewSchema,
    runVersionApplied: Type.Boolean(),
  }),
)

/** 执行记录列表响应。 */
export const changeExecutionListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(executionViewSchema) }),
)

/** 重试请求体。 */
export const retryChangePlanBodySchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }), reason: Type.String() },
  { additionalProperties: false },
)

/** 重试响应。 */
export const retryChangePlanResponseSchema = apiResponseSchema(
  Type.Object({ plan: planViewSchema, execution: executionViewSchema }),
)

/** 事件分页响应。 */
export const changePlanEventListResponseSchema = apiResponseSchema(
  Type.Object({
    items: Type.Array(eventViewSchema),
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
  }),
)

/** 事件分页查询。 */
export const changePlanEventQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
)
