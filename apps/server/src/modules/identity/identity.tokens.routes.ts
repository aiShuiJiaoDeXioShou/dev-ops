import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { success, apiResponseSchema } from '../../platform/http/response.ts'
import { requireActor, requireSessionActor } from './identity.actor.ts'
import type { IdentityService } from './identity.service.ts'
import type { TokenService } from './identity.tokens.ts'

const uuidSchema = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const tokenStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('expired'), Type.Literal('revoked')])
const tokenMetadataSchema = Type.Object({
  id: uuidSchema,
  name: Type.String(),
  tokenPrefix: Type.String(),
  createdAt: Type.String(),
  expiresAt: Type.String(),
  lastUsedAt: Type.Union([Type.String(), Type.Null()]),
  revokedAt: Type.Union([Type.String(), Type.Null()]),
  status: tokenStatusSchema,
})
const createTokenBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
)
const tokenParamsSchema = Type.Object({ tokenId: uuidSchema })
const teamSummarySchema = Type.Object({
  id: uuidSchema,
  name: Type.String(),
  role: Type.Union([Type.Literal('admin'), Type.Literal('developer'), Type.Literal('viewer')]),
  status: Type.String(),
})
const meResponseSchema = apiResponseSchema(
  Type.Object({
    user: Type.Object({ id: uuidSchema, name: Type.String(), email: Type.String() }),
    teams: Type.Array(teamSummarySchema),
  }),
)
const tokenListResponseSchema = apiResponseSchema(Type.Object({ items: Type.Array(tokenMetadataSchema) }))
const tokenCreateResponseSchema = apiResponseSchema(
  Type.Object({ token: Type.String(), metadata: tokenMetadataSchema }),
)
const tokenResponseSchema = apiResponseSchema(tokenMetadataSchema)

/**
 * 注册 API Token 管理接口与当前身份接口。
 * @param app Fastify 插件实例。
 * @param options Token 服务、团队服务与认证实例。
 * @returns 注册完成的 Promise；管理接口只接受登录会话，不接受 API Token。
 */
export const identityTokenRoutes: FastifyPluginAsyncTypebox<{
  tokenService: TokenService
  service: IdentityService
}> = async (app, options) => {
  app.get('/me', { schema: { response: { 200: meResponseSchema } } }, async (request) => {
    const user = await requireActor(request)
    return success({ user, teams: await options.service.listMyTeams(user) }, request.id)
  })

  app.get('/me/tokens', { schema: { response: { 200: tokenListResponseSchema } } }, async (request) => {
    const user = await requireSessionActor(request)
    return success({ items: await options.tokenService.list(user.id) }, request.id)
  })

  app.post(
    '/me/tokens',
    {
      schema: {
        body: createTokenBodySchema,
        response: { 200: tokenCreateResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionActor(request)
      return success(await options.tokenService.create(user.id, request.body), request.id)
    },
  )

  app.post(
    '/me/tokens/:tokenId/revoke',
    {
      schema: {
        params: tokenParamsSchema,
        response: { 200: tokenResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionActor(request)
      return success(await options.tokenService.revoke(user.id, request.params.tokenId), request.id)
    },
  )
}
