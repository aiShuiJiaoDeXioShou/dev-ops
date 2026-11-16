import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import type { IntegrationsService } from './integrations.service.ts'
import {
  callbackParamsSchema,
  callbackQuerySchema,
  checkConnectionResponseSchema,
  connectionListResponseSchema,
  connectionParamsSchema,
  connectionRepositoryListResponseSchema,
  connectionRepositoryQuerySchema,
  createConnectionBodySchema,
  createConnectionResponseSchema,
  providerListResponseSchema,
  revokeConnectionBodySchema,
  revokeConnectionResponseSchema,
  syncRepositoriesResponseSchema,
  teamParamsSchema,
} from './integrations.schema.ts'

/** Git 提供方、连接与授权回调路由。 */
export const integrationsRoutes: FastifyPluginAsyncTypebox<{
  auth: IdentityAuth
  service: IntegrationsService
  webOrigin: string
}> = async (app, options) => {
  app.get(
    '/git-providers',
    {
      schema: { response: { 200: providerListResponseSchema } },
    },
    async (request) => {
      await requireActor(request)
      return success(options.service.providers(), request.id)
    },
  )

  app.get(
    '/teams/:teamId/git-connections',
    {
      schema: { params: teamParamsSchema, response: { 200: connectionListResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listConnections(user, request.params.teamId), request.id)
    },
  )

  app.post(
    '/teams/:teamId/git-connections',
    {
      schema: {
        params: teamParamsSchema,
        body: createConnectionBodySchema,
        response: { 200: createConnectionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.createConnection(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/git-authorizations/:providerKey/callback',
    {
      // GitHub OAuth 授权码通过查询串返回，避免写入请求日志或 Referer。
      logLevel: 'silent',
      schema: { params: callbackParamsSchema, querystring: callbackQuerySchema },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
      const redirect = new URL('/settings/team?tab=connections&git=failed', options.webOrigin)
      try {
        const { state, installation_id: installationId, code } = request.query
        if (state) {
          const user = await requireActor(request)
          const result = await options.service.completeAuthorization(user, request.params.providerKey, {
            state,
            installationId: installationId === undefined ? undefined : Number(installationId),
            code,
          })
          if ('authorizationUrl' in result) return reply.redirect(result.authorizationUrl, 302)
          redirect.searchParams.set('git', 'connected')
          return reply.redirect(redirect.href, 302)
        }
      } catch {
        // 对用户统一收口，避免把授权码和来源响应带回页面。
        return reply.redirect(redirect.href, 302)
      }
      return reply.redirect(redirect.href, 302)
    },
  )

  app.post(
    '/git-connections/:connectionId/check',
    {
      schema: { params: connectionParamsSchema, response: { 200: checkConnectionResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.checkConnection(user, request.params.connectionId), request.id)
    },
  )

  app.post(
    '/git-connections/:connectionId/sync-repositories',
    {
      schema: { params: connectionParamsSchema, response: { 200: syncRepositoriesResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.syncRepositories(user, request.params.connectionId), request.id)
    },
  )

  app.get(
    '/git-connections/:connectionId/repositories',
    {
      schema: {
        params: connectionParamsSchema,
        querystring: connectionRepositoryQuerySchema,
        response: { 200: connectionRepositoryListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listRepositories(user, request.params.connectionId, request.query),
        request.id,
      )
    },
  )

  app.post(
    '/git-connections/:connectionId/revoke',
    {
      schema: {
        params: connectionParamsSchema,
        body: revokeConnectionBodySchema,
        response: { 200: revokeConnectionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.revokeConnection(user, request.params.connectionId, request.body.reason),
        request.id,
      )
    },
  )
}
