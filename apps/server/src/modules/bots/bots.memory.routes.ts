import { Type } from 'typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { apiResponseSchema, success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import {
  botMemoryCreateBody,
  botMemoryListResponse,
  botMemoryParams,
  botMemoryQuery,
  botMemoryRemoveResponse,
  botMemoryResponse,
  botMemoryUpdateBody,
} from './bots.memory.schema.ts'
import type { BotMemoryService } from './bots.memory.service.ts'
import { botParams, botTeamParams } from './bots.schema.ts'

/**
 * 注册团队长期记忆的查询和写入接口。
 * @param app 平台 HTTP 实例。
 * @param options 根据当前成员鉴权的长期记忆服务。
 * @returns 注册完成，浏览者只有列表读取权限。
 */
export const botMemoryRoutes: FastifyPluginAsyncTypebox<{ service: BotMemoryService }> = async (app, { service }) => {
  app.post(
    '/bots/:botId/memories/consolidate',
    {
      schema: {
        summary: '排队整理 Bot 长期记忆',
        params: botParams,
        response: { 200: apiResponseSchema(Type.Object({ runId: Type.Union([Type.String(), Type.Null()]) })) },
      },
    },
    async (request) =>
      success(await service.consolidate(await requireActor(request), request.params.botId), request.id),
  )
  app.get(
    '/teams/:teamId/bot-memories',
    {
      schema: {
        summary: '检索团队 Bot 笔记和本人画像',
        params: botTeamParams,
        querystring: botMemoryQuery,
        response: { 200: botMemoryListResponse },
      },
    },
    async (request) =>
      success(await service.list(await requireActor(request), request.params.teamId, request.query), request.id),
  )
  app.post(
    '/teams/:teamId/bot-memories',
    {
      schema: {
        summary: '保存长期记忆',
        params: botTeamParams,
        body: botMemoryCreateBody,
        response: { 200: botMemoryResponse },
      },
    },
    async (request) =>
      success(await service.create(await requireActor(request), request.params.teamId, request.body), request.id),
  )
  app.post(
    '/bot-memories/:memoryId/update',
    {
      schema: {
        summary: '局部更新长期记忆',
        params: botMemoryParams,
        body: botMemoryUpdateBody,
        response: { 200: botMemoryResponse },
      },
    },
    async (request) =>
      success(await service.update(await requireActor(request), request.params.memoryId, request.body), request.id),
  )
  app.post(
    '/bot-memories/:memoryId/remove',
    { schema: { summary: '删除长期记忆', params: botMemoryParams, response: { 200: botMemoryRemoveResponse } } },
    async (request) => success(await service.remove(await requireActor(request), request.params.memoryId), request.id),
  )
}
