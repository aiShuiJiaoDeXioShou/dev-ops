import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from './identity.actor.ts'
import type { IdentityService } from './identity.service.ts'
import type { IdentityAuth } from './identity.auth.ts'
import {
  acceptInvitationBodySchema,
  acceptInvitationResponseSchema,
  createTeamBodySchema,
  createTeamResponseSchema,
  invitationListResponseSchema,
  invitationParamsSchema,
  invitationPublicResponseSchema,
  invitationQuerySchema,
  invitationResponseSchema,
  inviteMemberBodySchema,
  memberListResponseSchema,
  memberParamsSchema,
  memberResponseSchema,
  memberUpdateBodySchema,
  teamParamsSchema,
  teamSummaryListResponseSchema,
  updateTeamBodySchema,
  updateTeamResponseSchema,
  tokenParamsSchema,
} from './identity.team.schema.ts'

/**
 * 注册团队、成员与邀请接口。
 * @param app Fastify 插件实例。
 * @param options 认证实例与身份业务服务。
 * @returns 注册完成的 Promise；所有自研接口返回 HTTP 200 信封。
 */
export const identityTeamRoutes: FastifyPluginAsyncTypebox<{
  auth: IdentityAuth
  service: IdentityService
}> = async (app, options) => {
  app.get(
    '/me/teams',
    {
      schema: { response: { 200: teamSummaryListResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listMyTeams(user), request.id)
    },
  )

  app.post(
    '/teams/:teamId/update',
    {
      schema: {
        params: teamParamsSchema,
        body: updateTeamBodySchema,
        response: { 200: updateTeamResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.updateTeam(user, request.params.teamId, request.body), request.id)
    },
  )

  app.post(
    '/platform/teams',
    {
      schema: {
        body: createTeamBodySchema,
        response: { 200: createTeamResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.createTeamAsRoot(user, request.body), request.id)
    },
  )

  app.get(
    '/teams/:teamId/members',
    {
      schema: { params: teamParamsSchema, response: { 200: memberListResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listMembers(user, request.params.teamId), request.id)
    },
  )

  app.post(
    '/teams/:teamId/members/:userId/update',
    {
      schema: {
        params: memberParamsSchema,
        body: memberUpdateBodySchema,
        response: { 200: memberResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      const member = await options.service.updateMember(
        user,
        request.params.teamId,
        request.params.userId,
        request.body,
      )
      return success(member, request.id)
    },
  )

  app.get(
    '/teams/:teamId/invitations',
    {
      schema: {
        params: teamParamsSchema,
        querystring: invitationQuerySchema,
        response: { 200: invitationListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listTeamInvitations(user, request.params.teamId, request.query.status),
        request.id,
      )
    },
  )

  app.post(
    '/teams/:teamId/invitations',
    {
      schema: {
        params: teamParamsSchema,
        body: inviteMemberBodySchema,
        response: { 200: invitationResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.inviteMember(user, request.params.teamId, request.body), request.id)
    },
  )

  app.post(
    '/teams/:teamId/invitations/:invitationId/resend',
    {
      schema: { params: invitationParamsSchema, response: { 200: invitationResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.resendInvitation(user, request.params.teamId, request.params.invitationId),
        request.id,
      )
    },
  )

  app.post(
    '/teams/:teamId/invitations/:invitationId/revoke',
    {
      schema: { params: invitationParamsSchema, response: { 200: invitationResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.revokeInvitation(user, request.params.teamId, request.params.invitationId),
        request.id,
      )
    },
  )

  app.get(
    '/invitations/:token',
    {
      schema: { params: tokenParamsSchema, response: { 200: invitationPublicResponseSchema } },
    },
    async (request) => {
      return success(await options.service.getInvitationByToken(request.params.token), request.id)
    },
  )

  app.post(
    '/invitations/:token/accept',
    {
      schema: {
        params: tokenParamsSchema,
        body: acceptInvitationBodySchema,
        response: { 200: acceptInvitationResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await options.service.acceptInvitation(request.params.token, request.body)
      if (result.cookies.length > 0) reply.header('set-cookie', result.cookies)
      return success(
        {
          userId: result.userId,
          teamId: result.teamId,
          teamName: result.teamName,
          role: result.role,
        },
        request.id,
      )
    },
  )
}
