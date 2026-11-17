import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { conversationParams } from '../collaboration/bot-conversations.schema.ts'
import { requireActor } from '../identity/identity.actor.ts'
import {
  runParams,
  runResponse,
  taskAppendBody,
  taskCreateBody,
  taskDetailResponse,
  taskListQuery,
  taskListResponse,
  taskParams,
  taskResponse,
  taskRunResponse,
  taskVersionBody,
} from './bot-tasks.schema.ts'
import type { BotTasksService } from './bot-tasks.service.ts'

/**
 * 注册会话任务与 Bot 运行操作。
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
  app.post(
    '/bot-conversations/:conversationId/tasks',
    {
      schema: {
        summary: '为会话创建任务并安排工作',
        params: conversationParams,
        body: taskCreateBody,
        response: { 200: taskRunResponse },
      },
    },
    async (request) =>
      success(
        await service.create(await requireActor(request), request.params.conversationId, request.body),
        request.id,
      ),
  )
  app.get(
    '/bot-tasks/:taskId',
    { schema: { summary: '读取任务需求与运行轨迹', params: taskParams, response: { 200: taskDetailResponse } } },
    async (request) => success(await service.get(await requireActor(request), request.params.taskId), request.id),
  )
  app.post(
    '/bot-tasks/:taskId/append',
    {
      schema: {
        summary: '补充等待中的任务要求',
        params: taskParams,
        body: taskAppendBody,
        response: { 200: taskResponse },
      },
    },
    async (request) =>
      success(await service.append(await requireActor(request), request.params.taskId, request.body), request.id),
  )
  app.post(
    '/bot-tasks/:taskId/rerun',
    {
      schema: {
        summary: '用当前输入版本重新运行任务',
        params: taskParams,
        body: taskVersionBody,
        response: { 200: taskRunResponse },
      },
    },
    async (request) =>
      success(
        await service.rerun(await requireActor(request), request.params.taskId, request.body.version),
        request.id,
      ),
  )
  app.post(
    '/bot-tasks/:taskId/cancel',
    {
      schema: {
        summary: '取消任务并请求其在途运行停止',
        params: taskParams,
        body: taskVersionBody,
        response: { 200: taskResponse },
      },
    },
    async (request) =>
      success(
        await service.cancel(await requireActor(request), request.params.taskId, request.body.version),
        request.id,
      ),
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
