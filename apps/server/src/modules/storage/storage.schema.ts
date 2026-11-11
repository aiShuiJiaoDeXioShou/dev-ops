import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const probeResultSchema = Type.Union([
  Type.Literal('read_write'),
  Type.Literal('read_only'),
  Type.Literal('unreachable'),
  Type.Literal('auth_failed'),
])
const bucketKindSchema = Type.Union([Type.Literal('local'), Type.Literal('s3')])
const bucketStatusSchema = Type.Union([Type.Literal('enabled'), Type.Literal('disabled')])

const bucketLastProbeSchema = Type.Object({
  result: probeResultSchema,
  message: Type.Union([Type.String(), Type.Null()]),
  at: Type.Union([Type.String(), Type.Null()]),
})

/** 储存桶对外视图；只含掩码与探测信息，不含任何凭据列。 */
const storageBucketViewSchema = Type.Object({
  id: uuidSchema,
  name: Type.String(),
  kind: bucketKindSchema,
  isBuiltin: Type.Boolean(),
  isDefault: Type.Boolean(),
  status: bucketStatusSchema,
  endpoint: Type.Union([Type.String(), Type.Null()]),
  bucketName: Type.Union([Type.String(), Type.Null()]),
  region: Type.Union([Type.String(), Type.Null()]),
  pathPrefix: Type.Union([Type.String(), Type.Null()]),
  accessKeyHint: Type.Union([Type.String(), Type.Null()]),
  lastProbe: Type.Union([bucketLastProbeSchema, Type.Null()]),
  version: Type.Integer(),
  updatedAt: Type.String(),
})

/** 储存桶列表响应。 */
export const storageBucketListResponseSchema = apiResponseSchema(
  Type.Object({ buckets: Type.Array(storageBucketViewSchema) }),
)

/** 单个储存桶响应；创建、更新与设为默认复用。 */
export const storageBucketResponseSchema = apiResponseSchema(storageBucketViewSchema)

/** 连接测试响应；结论持久化在桶记录中。 */
export const storageBucketProbeResponseSchema = apiResponseSchema(
  Type.Object({
    result: probeResultSchema,
    message: Type.String(),
    checkedAt: Type.String(),
  }),
)

/** 删除储存桶响应。 */
export const storageBucketRemoveResponseSchema = apiResponseSchema(
  Type.Object({ id: uuidSchema, removed: Type.Literal(true) }),
)

/** 储存桶路由参数。 */
export const storageBucketParamsSchema = Type.Object({ bucketId: uuidSchema })

/** 创建储存桶请求；首期只允许 s3，Secret 只写不读。 */
export const createStorageBucketBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    kind: Type.Literal('s3'),
    endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
    bucketName: Type.String({ minLength: 1, maxLength: 255 }),
    region: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    pathPrefix: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
    accessKeyId: Type.String({ minLength: 1, maxLength: 256 }),
    secretAccessKey: Type.String({ minLength: 1, maxLength: 512 }),
    setAsDefault: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

/** 更新储存桶请求；除 version 外全部可选，secretAccessKey 省略表示保持原值。 */
export const updateStorageBucketBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    endpoint: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    bucketName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    region: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    pathPrefix: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
    accessKeyId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    secretAccessKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    status: Type.Optional(bucketStatusSchema),
  },
  { additionalProperties: false },
)

/** 设为默认桶请求；版本用于防止并发覆盖。 */
export const setDefaultStorageBucketBodySchema = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)
