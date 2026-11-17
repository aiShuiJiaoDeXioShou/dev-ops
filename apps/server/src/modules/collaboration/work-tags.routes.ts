import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { conversationTeamParams } from './bot-conversations.schema.ts'
import {
  workTagBody,
  workTagLinkBody,
  workTagListQuery,
  workTagListResponse,
  workTagMutationResponse,
  workTagParams,
  workTagResponse,
} from './work-tags.schema.ts'
import type { WorkTagsService } from './work-tags.service.ts'

/**
 * 注册团队工作标签与任务、会话关联接口。
 * @param app 平台 HTTP 实例。
 * @param options 标签业务端口。
 * @returns 注册完成，关联修改需校验当前会话成员权限。
 */
export const workTagRoutes: FastifyPluginAsyncTypebox<{ service: WorkTagsService }> = async (app, { service }) => {
  app.get(
    '/teams/:teamId/work-tags',
    {
      schema: {
        summary: '列出团队工作标签',
        params: conversationTeamParams,
        querystring: workTagListQuery,
        response: { 200: workTagListResponse },
      },
    },
    async (request) =>
      success(await service.list(await requireActor(request), request.params.teamId, request.query), request.id),
  )
  app.post(
    '/teams/:teamId/work-tags',
    {
      schema: {
        summary: '创建或复用团队工作标签',
        params: conversationTeamParams,
        body: workTagBody,
        response: { 200: workTagResponse },
      },
    },
    async (request) =>
      success(await service.create(await requireActor(request), request.params.teamId, request.body.name), request.id),
  )
  app.post(
    '/work-tags/:tagId/update',
    {
      schema: {
        summary: '修改工作标签名称',
        params: workTagParams,
        body: workTagBody,
        response: { 200: workTagResponse },
      },
    },
    async (request) =>
      success(await service.rename(await requireActor(request), request.params.tagId, request.body.name), request.id),
  )
  app.post(
    '/work-tags/:tagId/remove',
    { schema: { summary: '删除工作标签及其关联', params: workTagParams, response: { 200: workTagMutationResponse } } },
    async (request) => success(await service.remove(await requireActor(request), request.params.tagId), request.id),
  )
  for (const action of ['link', 'unlink'] as const) {
    app.post(
      `/work-tags/:tagId/${action}`,
      {
        schema: {
          summary: action === 'link' ? '关联工作标签' : '取消关联标签',
          params: workTagParams,
          body: workTagLinkBody,
          response: { 200: workTagMutationResponse },
        },
      },
      async (request) =>
        success(
          await service.link(await requireActor(request), request.params.tagId, request.body, action === 'link'),
          request.id,
        ),
    )
  }
}
