import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import {
  conversationEventsQuery,
  conversationEventsResponse,
  conversationListQuery,
  conversationListResponse,
  conversationMessagesQuery,
  conversationMessagesResponse,
  conversationParams,
  conversationResponse,
  conversationSendResponse,
  conversationTeamParams,
  createDirectConversationBody,
  sendBotMessageBody,
} from './bot-conversations.schema.ts'
import type { BotConversationsService } from './bot-conversations.service.ts'

/**
 * 注册平台 Bot 私聊、消息与运行事件接口。
 * @param app HTTP 实例。
 * @param options 会话用例。
 * @returns 注册完成，访问范围由会话成员关系决定。
 */
export const botConversationsRoutes: FastifyPluginAsyncTypebox<{ service: BotConversationsService }> = async (
  app,
  { service },
) => {
  app.get(
    '/teams/:teamId/bot-conversations',
    {
      schema: {
        summary: '列出当前成员可见的 Bot 会话',
        params: conversationTeamParams,
        querystring: conversationListQuery,
        response: { 200: conversationListResponse },
      },
    },
    async (request) =>
      success(await service.list(await requireActor(request), request.params.teamId, request.query), request.id),
  )
  app.post(
    '/teams/:teamId/bot-conversations',
    {
      schema: {
        summary: '创建或打开 Bot 私聊',
        params: conversationTeamParams,
        body: createDirectConversationBody,
        response: { 200: conversationResponse },
      },
    },
    async (request) =>
      success(
        await service.createDirect(await requireActor(request), request.params.teamId, request.body.botId),
        request.id,
      ),
  )
  app.get(
    '/bot-conversations/:conversationId',
    {
      schema: {
        summary: '读取 Bot 会话与成员',
        params: conversationParams,
        response: { 200: conversationResponse },
      },
    },
    async (request) =>
      success(await service.get(await requireActor(request), request.params.conversationId), request.id),
  )
  app.get(
    '/bot-conversations/:conversationId/messages',
    {
      schema: {
        summary: '分页读取 Bot 会话消息',
        params: conversationParams,
        querystring: conversationMessagesQuery,
        response: { 200: conversationMessagesResponse },
      },
    },
    async (request) =>
      success(
        await service.messages(
          await requireActor(request),
          request.params.conversationId,
          request.query.before,
          request.query.limit,
        ),
        request.id,
      ),
  )
  app.post(
    '/bot-conversations/:conversationId/messages',
    {
      // 该路由在会话事务中使用 clientRequestId 去重，重试需要返回原消息和运行。
      config: { idempotency: false },
      schema: {
        summary: '向 Bot 会话发送消息并安排运行',
        params: conversationParams,
        body: sendBotMessageBody,
        response: { 200: conversationSendResponse },
      },
    },
    async (request) =>
      success(await service.send(await requireActor(request), request.params.conversationId, request.body), request.id),
  )
  app.get(
    '/bot-conversations/:conversationId/events',
    {
      schema: {
        summary: '增量读取 Bot 会话的运行事件',
        params: conversationParams,
        querystring: conversationEventsQuery,
        response: { 200: conversationEventsResponse },
      },
    },
    async (request) =>
      success(
        await service.events(await requireActor(request), request.params.conversationId, request.query.after),
        request.id,
      ),
  )
}
