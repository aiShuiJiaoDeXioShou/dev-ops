import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireHumanActor } from '../identity/identity.actor.ts'
import type { KnowledgeService } from './knowledge.service.ts'
import {
  activityPageResponseSchema,
  createSkillBodySchema,
  pageQuerySchema,
  skillDetailResponseSchema,
  skillListQuerySchema,
  skillPageResponseSchema,
  skillParamsSchema,
  skillStateBodySchema,
  skillVersionDetailResponseSchema,
  skillVersionPageResponseSchema,
  skillVersionParamsSchema,
  teamParamsSchema,
  updateSkillBodySchema,
} from './knowledge.schema.ts'

/**
 * 团队技能目录、管理与历史版本路由。
 * @param app Fastify 实例。
 * @param options 技能服务。
 * @returns 无返回值；只注册 GET 与 POST。
 */
export const knowledgeRoutes: FastifyPluginAsyncTypebox<{
  service: KnowledgeService
}> = async (app, options) => {
  // 技能目录与检索
  app.get(
    '/teams/:teamId/skills',
    {
      schema: {
        summary: '读取团队技能列表',
        params: teamParamsSchema,
        querystring: skillListQuerySchema,
        response: { 200: skillPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await options.service.listSkills(user, request.params.teamId, request.query), request.id)
    },
  )

  app.post(
    '/teams/:teamId/skills',
    {
      schema: {
        summary: '创建团队技能',
        params: teamParamsSchema,
        body: createSkillBodySchema,
        response: { 200: skillDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await options.service.createSkill(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/skills/:skillId',
    { schema: { summary: '读取技能详情', params: skillParamsSchema, response: { 200: skillDetailResponseSchema } } },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await options.service.getSkill(user, request.params.skillId), request.id)
    },
  )

  app.post(
    '/skills/:skillId/update',
    {
      schema: {
        summary: '更新技能',
        params: skillParamsSchema,
        body: updateSkillBodySchema,
        response: { 200: skillDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await options.service.updateSkill(user, request.params.skillId, request.body), request.id)
    },
  )

  app.post(
    '/skills/:skillId/enable',
    {
      schema: {
        summary: '启用技能',
        params: skillParamsSchema,
        body: skillStateBodySchema,
        response: { 200: skillDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await options.service.enableSkill(user, request.params.skillId, request.body.version), request.id)
    },
  )

  app.post(
    '/skills/:skillId/disable',
    {
      schema: {
        summary: '停用技能',
        params: skillParamsSchema,
        body: skillStateBodySchema,
        response: { 200: skillDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await options.service.disableSkill(user, request.params.skillId, request.body.version), request.id)
    },
  )

  app.get(
    '/skills/:skillId/versions',
    {
      schema: {
        summary: '读取技能版本列表',
        params: skillParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: skillVersionPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(
        await options.service.listSkillVersions(
          user,
          request.params.skillId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/skills/:skillId/versions/:skillVersionId',
    {
      schema: {
        summary: '读取技能版本详情',
        params: skillVersionParamsSchema,
        response: { 200: skillVersionDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(
        await options.service.getSkillVersion(user, request.params.skillId, request.params.skillVersionId),
        request.id,
      )
    },
  )

  app.get(
    '/skills/:skillId/activities',
    {
      schema: {
        summary: '读取技能活动记录',
        params: skillParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: activityPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(
        await options.service.listSkillActivities(
          user,
          request.params.skillId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )
}
