import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor, requireHumanActor, requireSessionActor } from '../identity/identity.actor.ts'
import {
  connectionIdParams,
  connectionResponse,
  connectionsResponse,
  connectionVersionBody,
  createConnectionBody,
  modelCatalogResponse,
  modelProviderQuery,
  startLoginBody,
} from './bots.connections.schema.ts'
import type { BotConnectionsService } from './bots.connections.service.ts'
import {
  loginSessionParams,
  loginSessionCreated,
  loginSessionResponse,
  loginAnswerBody,
  type BotLoginService,
} from './bots.login.service.ts'
import { botTeamParams } from './bots.schema.ts'

/**
 * 注册团队模型目录、连接和订阅授权路由。
 * @param app HTTP 实例。
 * @param options 连接与登录用例。
 * @returns 注册完成，只使用 GET/POST 和平台响应信封。
 */
export const botConnectionsRoutes: FastifyPluginAsyncTypebox<{
  connections: BotConnectionsService
  login: BotLoginService
}> = async (app, { connections, login }) => {
  app.get(
    '/teams/:teamId/bot-model-connections',
    {
      schema: {
        summary: '读取团队模型连接的公开信息',
        params: botTeamParams,
        response: { 200: connectionsResponse },
      },
    },
    async (request) => success(await connections.list(await requireActor(request), request.params.teamId), request.id),
  )
  app.get(
    '/teams/:teamId/bot-model-catalog',
    {
      schema: {
        summary: '读取可配置的对话模型目录',
        params: botTeamParams,
        querystring: modelProviderQuery,
        response: { 200: modelCatalogResponse },
      },
    },
    async (request) =>
      success(
        await connections.catalog(await requireActor(request), request.params.teamId, request.query.providerId),
        request.id,
      ),
  )
  app.post(
    '/teams/:teamId/bot-model-connections',
    {
      schema: {
        summary: '配置团队 API Key 连接',
        params: botTeamParams,
        body: createConnectionBody,
        response: { 200: connectionResponse },
      },
    },
    async (request) =>
      success(
        await connections.create(await requireHumanActor(request), request.params.teamId, request.body),
        request.id,
      ),
  )
  app.post(
    '/teams/:teamId/bot-model-connections/oauth-login',
    {
      schema: {
        summary: '发起提供方订阅登录',
        params: botTeamParams,
        body: startLoginBody,
        response: { 200: loginSessionCreated },
      },
    },
    async (request) =>
      success(await login.start(await requireSessionActor(request), request.params.teamId, request.body), request.id),
  )
  app.get(
    '/bot-model-login-sessions/:sessionId',
    {
      schema: {
        summary: '读取订阅授权的当前步骤',
        params: loginSessionParams,
        response: { 200: loginSessionResponse },
      },
    },
    async (request) =>
      success(await login.get(await requireSessionActor(request), request.params.sessionId), request.id),
  )
  app.post(
    '/bot-model-login-sessions/:sessionId/answer',
    {
      schema: {
        summary: '提交订阅授权的输入',
        params: loginSessionParams,
        body: loginAnswerBody,
        response: { 200: loginSessionResponse },
      },
    },
    async (request) =>
      success(
        await login.answer(await requireSessionActor(request), request.params.sessionId, request.body.value),
        request.id,
      ),
  )
  app.post(
    '/bot-model-login-sessions/:sessionId/cancel',
    {
      schema: {
        summary: '取消订阅授权',
        params: loginSessionParams,
        response: { 200: loginSessionResponse },
      },
    },
    async (request) =>
      success(await login.cancel(await requireSessionActor(request), request.params.sessionId), request.id),
  )
  for (const enabled of [false, true]) {
    app.post(
      enabled ? '/bot-model-connections/:connectionId/enable' : '/bot-model-connections/:connectionId/disable',
      {
        schema: {
          summary: enabled ? '启用模型连接' : '停用模型连接',
          params: connectionIdParams,
          body: connectionVersionBody,
          response: { 200: connectionResponse },
        },
      },
      async (request) =>
        success(
          await connections.setEnabled(
            await requireHumanActor(request),
            request.params.connectionId,
            request.body.version,
            enabled,
          ),
          request.id,
        ),
    )
  }
}
