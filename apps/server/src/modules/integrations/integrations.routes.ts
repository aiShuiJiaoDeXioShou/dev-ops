import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import { requireSessionUser } from '../identity/identity.session.ts'
import { PERSONAL_GITHUB_STATE_PREFIX, type GitHubAccountService } from './integrations.github-account.service.ts'
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
  githubInstallationListResponseSchema,
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
  githubAccount: GitHubAccountService
  webOrigin: string
}> = async (app, options) => {
  app.get(
    '/git-providers',
    {
      schema: { summary: '读取 Git 提供方列表', response: { 200: providerListResponseSchema } },
    },
    async (request) => {
      await requireActor(request)
      return success(options.service.providers(), request.id)
    },
  )

  app.get(
    '/teams/:teamId/git-connections',
    {
      schema: {
        summary: '读取团队 Git 连接列表',
        params: teamParamsSchema,
        response: { 200: connectionListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listConnections(user, request.params.teamId), request.id)
    },
  )

  app.post(
    '/teams/:teamId/github-installations/discover',
    {
      schema: {
        summary: '发现团队可用的 GitHub 安装',
        description: '查询团队管理员可访问的现有 GitHub App 安装，必要时刷新个人授权令牌。',
        params: teamParamsSchema,
        response: { 200: githubInstallationListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.discoverGitHubInstallations(user, request.params.teamId), request.id)
    },
  )

  app.post(
    '/teams/:teamId/git-connections',
    {
      schema: {
        summary: '创建团队 Git 连接',
        params: teamParamsSchema,
        body: createConnectionBodySchema,
        response: { 200: createConnectionResponseSchema },
      },
    },
    async (request) => {
      const user =
        request.body.installationId === undefined
          ? await requireActor(request)
          : await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createConnection(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/git-authorizations/:providerKey/callback',
    {
      // GitHub OAuth 授权码通过查询串返回，避免写入请求日志或 Referer。
      logLevel: 'silent',
      schema: {
        summary: '处理 Git 提供方授权回调',
        description: 'GitHub App 团队安装与个人身份绑定共用回调，使用 HTTP 302 跳回平台或继续授权。',
        params: callbackParamsSchema,
        querystring: callbackQuerySchema,
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
      const { state, installation_id: installationId, code } = request.query
      if (request.params.providerKey === 'github' && state?.startsWith(PERSONAL_GITHUB_STATE_PREFIX)) {
        let target = new URL('/settings/profile?githubAccount=failed', options.webOrigin)
        try {
          const user = await requireSessionUser(options.auth, request.headers)
          const result = await options.githubAccount.complete(user.id, state, code)
          target = new URL(result.returnTo, options.webOrigin)
          target.searchParams.set('githubAccount', result.result)
        } catch {
          // 回调含一次性授权码，失败统一回到个人页。
          return reply.redirect(target.href, 302)
        }
        return reply.redirect(target.href, 302)
      }
      const redirect = new URL('/settings/team?tab=connections&git=failed', options.webOrigin)
      try {
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
      schema: {
        summary: '检查 Git 连接状态',
        params: connectionParamsSchema,
        response: { 200: checkConnectionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.checkConnection(user, request.params.connectionId), request.id)
    },
  )

  app.post(
    '/git-connections/:connectionId/sync-repositories',
    {
      schema: {
        summary: '同步 Git 连接仓库',
        params: connectionParamsSchema,
        response: { 200: syncRepositoriesResponseSchema },
      },
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
        summary: '读取 Git 连接下的仓库',
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
        summary: '撤销 Git 连接',
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
