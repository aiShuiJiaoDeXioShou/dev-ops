import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.js'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const providerSchema = Type.Object({
  providerKey: Type.String(),
  name: Type.String(),
  authModes: Type.Array(Type.String()),
})
const connectionSchema = Type.Object({
  id: uuidSchema,
  teamId: uuidSchema,
  providerKey: Type.String(),
  instanceUrl: Type.String(),
  name: Type.String(),
  status: Type.String(),
  authKind: Type.String(),
  externalIdentity: Type.Union([Type.String(), Type.Null()]),
  lastCheckedAt: Type.Union([Type.String(), Type.Null()]),
  lastErrorCode: Type.Union([Type.String(), Type.Null()]),
  repositoryScopeSyncedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
})
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
const pageMeta = { page: Type.Integer(), pageSize: Type.Integer(), total: Type.Integer() }

export const providerListResponseSchema = apiResponseSchema(Type.Array(providerSchema))
export const connectionListResponseSchema = apiResponseSchema(Type.Array(connectionSchema))
export const teamParamsSchema = Type.Object({ teamId: uuidSchema })
export const connectionParamsSchema = Type.Object({ connectionId: uuidSchema })
export const createConnectionBodySchema = Type.Object(
  {
    providerKey: Type.Union([Type.Literal('github'), Type.Literal('gitea')]),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    instanceUrl: Type.Optional(Type.String({ maxLength: 2048 })),
    token: Type.Optional(Type.String({ maxLength: 100000 })),
  },
  { additionalProperties: false },
)
export const createConnectionResponseSchema = apiResponseSchema(
  Type.Union([connectionSchema, Type.Object({ authorizationUrl: Type.String(), expiresAt: Type.String() })]),
)
export const checkConnectionResponseSchema = apiResponseSchema(
  Type.Object({
    status: Type.String(),
    checkedAt: Type.String(),
    errorCode: Type.Optional(Type.String()),
    connection: Type.Union([connectionSchema, Type.Null()]),
  }),
)
export const syncRepositoriesResponseSchema = apiResponseSchema(
  Type.Object({
    synced: Type.Integer(),
    total: Type.Integer(),
    checkedAt: Type.String(),
  }),
)
export const connectionRepositoryListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(repositorySchema), ...pageMeta }),
)
export const connectionRepositoryQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 200 })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const revokeConnectionBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
)
export const revokeConnectionResponseSchema = apiResponseSchema(connectionSchema)
export const callbackParamsSchema = Type.Object({ providerKey: Type.String() })
export const callbackQuerySchema = Type.Object({
  state: Type.String({ minLength: 1, maxLength: 4096 }),
  installation_id: Type.String({ pattern: '^[0-9]+$' }),
  setup_action: Type.Optional(Type.String()),
})
