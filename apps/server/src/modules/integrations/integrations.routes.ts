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
      schema: { params: callbackParamsSchema, querystring: callbackQuerySchema },
    },
    async (request, reply) => {
      try {
        const user = await requireActor(request)
        await options.service.completeAuthorization(
          user,
          request.params.providerKey,
          request.query.state,
          Number(request.query.installation_id),
        )
        return reply.redirect(`${options.webOrigin}/settings/team?git=connected`, 302)
      } catch {
        return reply.redirect(`${options.webOrigin}/settings/team?git=failed`, 302)
      }
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
