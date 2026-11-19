import { Type } from 'typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { botSessionSettingBody } from '../bots/bots.session-settings.ts'
import { requireActor } from '../identity/identity.actor.ts'
import {
  conversationBotParams,
  conversationCompactResponse,
  conversationReseedResponse,
  conversationSettingsResponse,
  editResendBody,
  switchBotBranchBody,
  switchBotBranchResponse,
  forkConversationBody,
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
  messageFeedbackParams,
  messageFeedbackBody,
  messageFeedbackResponse,
} from './bot-conversations.schema.ts'
import type { BotConversationsService } from './bot-conversations.service.ts'
import { botGroupMemberBody, createBotGroupBody, updateBotGroupBody } from './bot-groups.schema.ts'
import type { BotGroupsService } from './bot-groups.service.ts'

/**
 * 注册平台 Bot 私聊、消息与运行事件接口。
 * @param app HTTP 实例。
 * @param options 会话用例。
 * @returns 注册完成，访问范围由会话成员关系决定。
 */
export const botConversationsRoutes: FastifyPluginAsyncTypebox<{
  service: BotConversationsService
  groups: BotGroupsService
}> = async (app, { service, groups }) => {
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
        summary: '创建 Bot 群组或打开私聊',
        params: conversationTeamParams,
        body: Type.Union([createDirectConversationBody, createBotGroupBody]),
        response: { 200: conversationResponse },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      const teamId = request.params.teamId
      const data =
        request.body.kind === 'direct'
          ? await service.createDirect(actor, teamId, request.body.botId)
          : await groups.create(actor, teamId, request.body)
      return success(data, request.id)
    },
  )
  app.post(
    '/bot-conversations/:conversationId/update',
    {
      schema: {
        summary: '更新 Bot 群组设置',
        params: conversationParams,
        body: updateBotGroupBody,
        response: { 200: conversationResponse },
      },
    },
    async (request) =>
      success(
        await groups.update(await requireActor(request), request.params.conversationId, request.body),
        request.id,
      ),
  )
  for (const action of ['add', 'remove'] as const) {
    app.post(
      `/bot-conversations/:conversationId/members/${action}`,
      {
        schema: {
          summary: action === 'add' ? '添加 Bot 会话成员' : '移出 Bot 会话成员',
          params: conversationParams,
          body: botGroupMemberBody,
          response: { 200: conversationResponse },
        },
      },
      async (request) =>
        success(
          await groups[action](await requireActor(request), request.params.conversationId, request.body),
          request.id,
        ),
    )
  }
  app.post(
    '/bot-conversations/:conversationId/messages/:messageId/edit-resend',
    {
      schema: {
        summary: '编辑重发私聊中的本人消息',
        params: messageFeedbackParams,
        body: editResendBody,
        response: { 200: conversationSendResponse },
      },
    },
    async (request) =>
      success(
        await service.editResend(
          await requireActor(request),
          request.params.conversationId,
          request.params.messageId,
          request.body,
        ),
        request.id,
      ),
  )
  app.post(
    '/bot-conversations/:conversationId/branches/switch',
    {
      schema: {
        summary: '切换私聊编辑分支',
        params: conversationParams,
        body: switchBotBranchBody,
        response: { 200: switchBotBranchResponse },
      },
    },
    async (request) =>
      success(
        await service.switchBranch(await requireActor(request), request.params.conversationId, request.body),
        request.id,
      ),
  )
  app.post(
    '/bot-conversations/:conversationId/fork',
    {
      schema: {
        summary: '从消息分叉独立的 Bot 会话',
        params: conversationParams,
        body: forkConversationBody,
        response: { 200: conversationResponse },
      },
    },
    async (request) =>
      success(await service.fork(await requireActor(request), request.params.conversationId, request.body), request.id),
  )
  app.post(
    '/bot-conversations/:conversationId/bots/:botId/settings',
    {
      schema: {
        summary: '保存会话 Bot 的模型与思考等级',
        params: conversationBotParams,
        body: botSessionSettingBody,
        response: { 200: conversationSettingsResponse },
      },
    },
    async (request) =>
      success(
        await service.settings(
          await requireActor(request),
          request.params.conversationId,
          request.params.botId,
          request.body,
        ),
        request.id,
      ),
  )
  app.post(
    '/bot-conversations/:conversationId/bots/:botId/compact',
    {
      schema: {
        summary: '排队压缩指定 Bot 的会话',
        params: conversationBotParams,
        response: { 200: conversationCompactResponse },
      },
    },
    async (request) =>
      success(
        await service.compact(await requireActor(request), request.params.conversationId, request.params.botId),
        request.id,
      ),
  )
  app.post(
    '/bot-conversations/:conversationId/bots/:botId/reseed',
    {
      schema: {
        summary: '重新播种损坏的 Bot 会话',
        params: conversationBotParams,
        response: { 200: conversationReseedResponse },
      },
    },
    async (request) =>
      success(
        await service.reseed(await requireActor(request), request.params.conversationId, request.params.botId),
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
  app.post(
    '/bot-conversations/:conversationId/messages/:messageId/feedback',
    {
      schema: {
        summary: '评价 Bot 回复',
        params: messageFeedbackParams,
        body: messageFeedbackBody,
        response: { 200: messageFeedbackResponse },
      },
    },
    async (request) =>
      success(
        await service.feedback(
          await requireActor(request),
          request.params.conversationId,
          request.params.messageId,
          request.body.rating,
        ),
        request.id,
      ),
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
        await service.events(await requireActor(request), request.params.conversationId, request.query),
        request.id,
      ),
  )
}
