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
  myTeamsResponseSchema,
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
      schema: { summary: '读取我的团队列表', response: { 200: myTeamsResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.getMyTeams(user), request.id)
    },
  )

  app.post(
    '/teams/:teamId/update',
    {
      schema: {
        summary: '更新团队资料',
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
      schema: { summary: '创建团队', body: createTeamBodySchema, response: { 200: createTeamResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.createTeamAsRoot(user, request.body), request.id)
    },
  )

  app.get(
    '/teams/:teamId/members',
    {
      schema: { summary: '读取团队成员列表', params: teamParamsSchema, response: { 200: memberListResponseSchema } },
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
        summary: '更新团队成员',
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
        summary: '读取团队邀请列表',
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
        summary: '创建团队邀请',
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
      schema: {
        summary: '重新发送团队邀请',
        params: invitationParamsSchema,
        response: { 200: invitationResponseSchema },
      },
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
      schema: { summary: '撤销团队邀请', params: invitationParamsSchema, response: { 200: invitationResponseSchema } },
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
      schema: { summary: '读取邀请详情', params: tokenParamsSchema, response: { 200: invitationPublicResponseSchema } },
    },
    async (request) => {
      return success(await options.service.getInvitationByToken(request.params.token), request.id)
    },
  )

  app.post(
    '/invitations/:token/accept',
    {
      schema: {
        summary: '接受团队邀请',
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
