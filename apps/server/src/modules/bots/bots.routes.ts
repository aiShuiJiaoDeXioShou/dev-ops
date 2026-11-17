import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import {
  bindBotModelBody,
  botCursorQuery,
  botListQuery,
  botListResponse,
  botParams,
  botResponse,
  botRunsResponse,
  botTeamParams,
  botVersionBody,
  createBotBody,
  updateBotBody,
} from './bots.schema.ts'
import type { BotsService } from './bots.service.ts'

/**
 * 注册团队 Bot 的管理和运行列表接口。
 * @param app HTTP 应用实例。
 * @param options Bot 服务，用于校验团队、角色和并发版本。
 * @returns 注册完成，只写入 GET/POST 路由。
 */
export const botsRoutes: FastifyPluginAsyncTypebox<{ service: BotsService }> = async (app, { service }) => {
  app.get(
    '/teams/:teamId/bots',
    {
      schema: {
        summary: '读取团队 Bot 列表',
        params: botTeamParams,
        querystring: botListQuery,
        response: { 200: botListResponse },
      },
    },
    async (request) =>
      success(await service.list(await requireActor(request), request.params.teamId, request.query), request.id),
  )
  app.post(
    '/teams/:teamId/bots',
    {
      schema: {
        summary: '创建团队 Bot',
        description: '管理员可以在创建时通过 modelBinding 同时绑定团队模型连接和模型。',
        params: botTeamParams,
        body: createBotBody,
        response: { 200: botResponse },
      },
    },
    async (request) =>
      success(await service.create(await requireActor(request), request.params.teamId, request.body), request.id),
  )
  app.get(
    '/bots/:botId',
    {
      schema: {
        summary: '查看 Bot 配置与可用性',
        params: botParams,
        response: { 200: botResponse },
      },
    },
    async (request) => success(await service.get(await requireActor(request), request.params.botId), request.id),
  )
  app.post(
    '/bots/:botId/update',
    {
      schema: {
        summary: '更新 Bot 配置',
        params: botParams,
        body: updateBotBody,
        response: { 200: botResponse },
      },
    },
    async (request) =>
      success(await service.update(await requireActor(request), request.params.botId, request.body), request.id),
  )
  app.post(
    '/bots/:botId/bind-model',
    {
      schema: {
        summary: '绑定 Bot 运行模型',
        params: botParams,
        body: bindBotModelBody,
        response: { 200: botResponse },
      },
    },
    async (request) =>
      success(await service.bind(await requireActor(request), request.params.botId, request.body), request.id),
  )
  for (const enabled of [true, false]) {
    app.post(
      enabled ? '/bots/:botId/enable' : '/bots/:botId/disable',
      {
        schema: {
          summary: enabled ? '启用 Bot' : '停用 Bot',
          params: botParams,
          body: botVersionBody,
          response: { 200: botResponse },
        },
      },
      async (request) =>
        success(
          await service.setEnabled(
            await requireActor(request),
            request.params.botId,
            request.body.configVersion,
            enabled,
          ),
          request.id,
        ),
    )
  }
  app.get(
    '/bots/:botId/runs',
    {
      schema: {
        summary: '查看可见会话中的 Bot 运行',
        params: botParams,
        querystring: botCursorQuery,
        response: { 200: botRunsResponse },
      },
    },
    async (request) =>
      success(await service.runs(await requireActor(request), request.params.botId, request.query.cursor), request.id),
  )
}
