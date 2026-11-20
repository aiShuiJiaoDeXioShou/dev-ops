import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { success, apiResponseSchema } from '../../platform/http/response.ts'
import { requireHumanActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import { requireSessionUser } from '../identity/identity.session.ts'
import type { GitHubAccountService } from './integrations.github-account.service.ts'

/**
 * 注册 GitHub 个人绑定接口；成员可用 API Token 查询状态，发起绑定需要浏览器会话。
 * @param app Fastify 路由实例。
 * @param options 认证与绑定服务。
 * @returns 路由注册完成；授权回调由 Git 集成模块的共用入口处理。
 */
export const gitHubAccountRoutes: FastifyPluginAsyncTypebox<{
  auth: IdentityAuth
  service: GitHubAccountService
}> = async (app, options) => {
  const { auth, service } = options

  app.get(
    '/me/github-account',
    {
      schema: {
        description: '查询当前登录用户已绑定的 GitHub 账号。',
        response: {
          200: apiResponseSchema(
            Type.Object({ login: Type.Union([Type.String(), Type.Null()]), enabled: Type.Boolean() }),
          ),
        },
      },
    },
    async (request) => {
      const actor = await requireHumanActor(request)
      return success(await service.status(actor.id), request.id)
    },
  )

  app.post(
    '/me/github-account/authorize',
    {
      schema: {
        description: '发起当前登录用户的 GitHub 绑定，可回到个人设置、代码、PR 或流水线页面。',
        body: Type.Object({ returnTo: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
        response: { 200: apiResponseSchema(Type.Object({ authorizationUrl: Type.String() })) },
      },
    },
    async (request) => {
      const actor = await requireSessionUser(auth, request.headers)
      return success(service.start(actor.id, request.body.returnTo), request.id)
    },
  )
}
