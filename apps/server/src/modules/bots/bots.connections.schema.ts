import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const authType = Type.Union([Type.Literal('api_key'), Type.Literal('oauth')])
const status = Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('login_failed')])
const parameters = {
  name: Type.String({ minLength: 1, maxLength: 60 }),
  providerId: Type.String({ minLength: 1, maxLength: 120 }),
}

const connection = Type.Object({
  id: uuid,
  name: Type.String(),
  providerId: Type.String(),
  authType,
  status,
  version: Type.Integer(),
  disabledReason: Type.Union([Type.String(), Type.Null()]),
  loginUserName: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
})
const model = Type.Object({
  providerId: Type.String(),
  modelId: Type.String(),
  displayName: Type.String(),
  authTypes: Type.Array(authType),
  contextWindow: Type.Union([Type.Integer(), Type.Null()]),
})

export const connectionIdParams = Type.Object({ connectionId: uuid })
export const modelProviderQuery = Type.Object({ providerId: Type.Optional(Type.String({ maxLength: 120 })) })
export const createConnectionBody = Type.Union([
  Type.Object({ ...parameters, credentialId: uuid }, { additionalProperties: false }),
  Type.Object(
    { ...parameters, apiKey: Type.String({ minLength: 1, maxLength: 8192 }) },
    { additionalProperties: false },
  ),
])
export const startLoginBody = Type.Object(parameters, { additionalProperties: false })
export const connectionVersionBody = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
)
export const connectionResponse = apiResponseSchema(connection)
export const connectionsResponse = apiResponseSchema(Type.Array(connection))
export const modelCatalogResponse = apiResponseSchema(Type.Array(model))

export type ModelConnectionInput = Static<typeof createConnectionBody>
export type BotModelConnectionView = Static<typeof connection>
export type StartLoginInput = Static<typeof startLoginBody>
