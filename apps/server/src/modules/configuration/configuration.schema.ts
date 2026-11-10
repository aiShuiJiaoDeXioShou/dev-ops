import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const timestampSchema = Type.String({ minLength: 1, maxLength: 40 })
const environmentSchema = Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')])
const credentialKindSchema = Type.Union([
  Type.Literal('api_key'),
  Type.Literal('account_password'),
  Type.Literal('ssh_key'),
])
const credentialStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('revoked'), Type.Literal('expired')])
const usageActionSchema = Type.Union([
  Type.Literal('use'),
  Type.Literal('create'),
  Type.Literal('rotate'),
  Type.Literal('revoke'),
  Type.Literal('grant'),
  Type.Literal('revoke_grant'),
  Type.Literal('read_metadata'),
  Type.Literal('reveal'),
])
const usageResultSchema = Type.Union([
  Type.Literal('success'),
  Type.Literal('denied'),
  Type.Literal('expired'),
  Type.Literal('failed'),
])
const envVarKindSchema = Type.Union([Type.Literal('plain'), Type.Literal('credential_ref')])
const envVarStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('invalid')])
const invalidReasonSchema = Type.Union([
  Type.Literal('credential_missing'),
  Type.Literal('credential_revoked'),
  Type.Literal('credential_expired'),
  Type.Literal('grant_revoked'),
  Type.Literal('grant_expired'),
  Type.Null(),
])

const optionalNullableTimestampSchema = Type.Optional(Type.Union([timestampSchema, Type.Null()]))
const optionalNullableTextSchema = (maxLength: number) =>
  Type.Optional(Type.Union([Type.String({ maxLength }), Type.Null()]))

const grantViewSchema = Type.Object({
  projectId: uuidSchema,
  projectName: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
})

const usageViewSchema = Type.Object({
  id: uuidSchema,
  credentialId: uuidSchema,
  credentialVersion: Type.Integer(),
  projectId: Type.Union([uuidSchema, Type.Null()]),
  environment: Type.Union([environmentSchema, Type.Null()]),
  action: usageActionSchema,
  actorUserId: Type.Union([uuidSchema, Type.Null()]),
  result: usageResultSchema,
  errorCode: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
})

const credentialViewFields = {
  id: uuidSchema,
  teamId: uuidSchema,
  name: Type.String(),
  kind: credentialKindSchema,
  description: Type.Union([Type.String(), Type.Null()]),
  status: credentialStatusSchema,
  currentVersion: Type.Integer(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  grants: Type.Array(grantViewSchema),
  maskedValue: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
}

const credentialViewSchema = Type.Object(credentialViewFields)
const credentialRevealViewSchema = Type.Object({
  value: Type.String(),
  version: Type.Integer(),
  revealedAt: Type.String(),
})
const credentialDetailViewSchema = Type.Object({
  ...credentialViewFields,
  recentUsage: Type.Array(usageViewSchema),
})

const envVarViewSchema = Type.Object({
  id: uuidSchema,
  projectId: uuidSchema,
  environment: environmentSchema,
  name: Type.String(),
  kind: envVarKindSchema,
  status: envVarStatusSchema,
  version: Type.Integer(),
  credential: Type.Union([
    Type.Object({
      id: uuidSchema,
      name: Type.String(),
      currentVersion: Type.Integer(),
      status: credentialStatusSchema,
    }),
    Type.Null(),
  ]),
  valuePreview: Type.Union([Type.String(), Type.Null()]),
  masked: Type.Boolean(),
  invalidReason: invalidReasonSchema,
  updatedAt: Type.String(),
})

const pageSchema = {
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
}

export const teamParamsSchema = Type.Object({ teamId: uuidSchema })
export const credentialParamsSchema = Type.Object({ credentialId: uuidSchema })
export const teamCredentialParamsSchema = Type.Object({ teamId: uuidSchema, credentialId: uuidSchema })
export const credentialGrantParamsSchema = Type.Object({ credentialId: uuidSchema, projectId: uuidSchema })
export const projectEnvironmentParamsSchema = Type.Object({ projectId: uuidSchema, environment: environmentSchema })
export const variableParamsSchema = Type.Object({ variableId: uuidSchema })

export const credentialListQuerySchema = Type.Object({
  kind: Type.Optional(credentialKindSchema),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('revoked')])),
  search: Type.Optional(Type.String({ maxLength: 200 })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const usageQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

export const createCredentialBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    kind: credentialKindSchema,
    description: optionalNullableTextSchema(1000),
    value: Type.String({ minLength: 1, maxLength: 100_000 }),
    expiresAt: optionalNullableTimestampSchema,
    projectGrants: Type.Optional(
      Type.Array(
        Type.Object({
          projectId: uuidSchema,
          expiresAt: optionalNullableTimestampSchema,
        }),
        { maxItems: 50 },
      ),
    ),
  },
  { additionalProperties: false },
)
export const rotateCredentialBodySchema = Type.Object(
  {
    value: Type.String({ minLength: 1, maxLength: 100_000 }),
    reason: optionalNullableTextSchema(1000),
  },
  { additionalProperties: false },
)
export const revokeCredentialBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false },
)
export const grantCredentialBodySchema = Type.Object(
  { projectId: uuidSchema, expiresAt: optionalNullableTimestampSchema },
  { additionalProperties: false },
)
export const revokeGrantBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false },
)
export const revealCredentialBodySchema = Type.Object(
  { password: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
)

export const createEnvVarBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    kind: envVarKindSchema,
    value: optionalNullableTextSchema(4000),
    credentialId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  },
  { additionalProperties: false },
)
export const updateEnvVarBodySchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    value: optionalNullableTextSchema(4000),
    credentialId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  },
  { additionalProperties: false },
)
export const removeEnvVarBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false },
)

export const credentialListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(credentialViewSchema), ...pageSchema }),
)
export const credentialDetailResponseSchema = apiResponseSchema(credentialDetailViewSchema)
export const credentialResponseSchema = apiResponseSchema(credentialViewSchema)
export const credentialRevealResponseSchema = apiResponseSchema(credentialRevealViewSchema)
export const credentialUsageListResponseSchema = apiResponseSchema(
  Type.Object({ items: Type.Array(usageViewSchema), ...pageSchema }),
)
export const envVarListResponseSchema = apiResponseSchema(Type.Object({ items: Type.Array(envVarViewSchema) }))
export const envVarResponseSchema = apiResponseSchema(envVarViewSchema)
export const envVarRemoveResponseSchema = apiResponseSchema(
  Type.Object({ id: uuidSchema, removed: Type.Literal(true) }),
)
