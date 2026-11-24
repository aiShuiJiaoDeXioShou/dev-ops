import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { conversationParams, conversationTeamParams } from '../collaboration/bot-conversations.schema.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { botInboxResponse } from './bot-inbox.read.ts'
import {
  runParams,
  runResponse,
  taskDetailResponse,
  taskListQuery,
  taskListResponse,
  taskParams,
} from './bot-tasks.schema.ts'
import type { BotTasksService } from './bot-tasks.service.ts'

/**
 * 注册旧任务只读查询与会话运行停止操作。
 * @param app HTTP 应用实例。
 * @param options 任务与运行用例。
 * @returns 注册完成，写操作由用例校验会话成员及角色。
 */
export const botTaskRoutes: FastifyPluginAsyncTypebox<{ service: BotTasksService }> = async (app, { service }) => {
  app.get(
    '/bot-conversations/:conversationId/tasks',
    {
      schema: {
        summary: '列出当前会话的任务',
        params: conversationParams,
        querystring: taskListQuery,
        response: { 200: taskListResponse },
      },
    },
    async (request) =>
      success(
        await service.list(await requireActor(request), request.params.conversationId, request.query.cursor),
        request.id,
      ),
  )
  app.get(
    '/bot-tasks/:taskId',
    { schema: { summary: '读取任务需求与运行轨迹', params: taskParams, response: { 200: taskDetailResponse } } },
    async (request) => success(await service.get(await requireActor(request), request.params.taskId), request.id),
  )
  app.get(
    '/teams/:teamId/bot-inbox',
    {
      schema: {
        summary: '列出等待当前成员回复的会话',
        params: conversationTeamParams,
        response: { 200: botInboxResponse },
      },
    },
    async (request) => success(await service.inbox(await requireActor(request), request.params.teamId), request.id),
  )
  app.post(
    '/bot-runs/:runId/stop',
    {
      schema: {
        summary: '停止排队中的运行或向执行服务发出停止请求',
        params: runParams,
        response: { 200: runResponse },
      },
    },
    async (request) => success(await service.stop(await requireActor(request), request.params.runId), request.id),
  )
}
