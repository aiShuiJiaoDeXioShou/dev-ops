import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import { requireSessionUser } from '../identity/identity.session.ts'
import type { KnowledgeService } from './knowledge.service.ts'
import {
  activityPageResponseSchema,
  applyProjectTemplateBodySchema,
  clearProjectTemplateBodySchema,
  createSkillBodySchema,
  createTemplateBodySchema,
  duplicateTemplateBodySchema,
  pageQuerySchema,
  projectParamsSchema,
  projectTemplateSelectionResponseSchema,
  skillDetailResponseSchema,
  skillListQuerySchema,
  skillPageResponseSchema,
  skillParamsSchema,
  skillStateBodySchema,
  skillVersionDetailResponseSchema,
  skillVersionPageResponseSchema,
  skillVersionParamsSchema,
  snapshotLinkCreatedResponseSchema,
  snapshotTokenParamsSchema,
  teamParamsSchema,
  templateDetailResponseSchema,
  templateListQuerySchema,
  templatePageResponseSchema,
  templateParamsSchema,
  templateSnapshotResponseSchema,
  templateVersionDetailResponseSchema,
  templateVersionPageResponseSchema,
  templateVersionParamsSchema,
  updateSkillBodySchema,
  updateTemplateBodySchema,
} from './knowledge.schema.ts'

/**
 * 知识资产路由：技能、AGENTS.md 模板、项目选用与快照链接。
 * @param app Fastify 实例。
 * @param options 认证实例与 knowledge 服务。
 * @returns 无返回值；只注册 GET 与 POST。
 */
export const knowledgeRoutes: FastifyPluginAsyncTypebox<{
  auth: IdentityAuth
  service: KnowledgeService
}> = async (app, options) => {
  // 技能目录与检索
  app.get(
    '/teams/:teamId/skills',
    {
      schema: {
        params: teamParamsSchema,
        querystring: skillListQuerySchema,
        response: { 200: skillPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.listSkills(user, request.params.teamId, request.query), request.id)
    },
  )

  app.post(
    '/teams/:teamId/skills',
    { schema: { params: teamParamsSchema, body: createSkillBodySchema, response: { 200: skillDetailResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createSkill(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/skills/:skillId',
    { schema: { params: skillParamsSchema, response: { 200: skillDetailResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getSkill(user, request.params.skillId), request.id)
    },
  )

  app.post(
    '/skills/:skillId/update',
    {
      schema: { params: skillParamsSchema, body: updateSkillBodySchema, response: { 200: skillDetailResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.updateSkill(user, request.params.skillId, request.body), request.id)
    },
  )

  app.post(
    '/skills/:skillId/enable',
    { schema: { params: skillParamsSchema, body: skillStateBodySchema, response: { 200: skillDetailResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.enableSkill(user, request.params.skillId, request.body.version), request.id)
    },
  )

  app.post(
    '/skills/:skillId/disable',
    { schema: { params: skillParamsSchema, body: skillStateBodySchema, response: { 200: skillDetailResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.disableSkill(user, request.params.skillId, request.body.version), request.id)
    },
  )

  app.get(
    '/skills/:skillId/versions',
    {
      schema: {
        params: skillParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: skillVersionPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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
        params: skillVersionParamsSchema,
        response: { 200: skillVersionDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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
        params: skillParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: activityPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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

  // 模板目录与文件管理
  app.get(
    '/teams/:teamId/agent-templates',
    {
      schema: {
        params: teamParamsSchema,
        querystring: templateListQuerySchema,
        response: { 200: templatePageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.listTemplates(user, request.params.teamId, request.query), request.id)
    },
  )

  app.post(
    '/teams/:teamId/agent-templates',
    {
      schema: {
        params: teamParamsSchema,
        body: createTemplateBodySchema,
        response: { 200: templateDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createTemplate(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/agent-templates/:templateId',
    { schema: { params: templateParamsSchema, response: { 200: templateDetailResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getTemplate(user, request.params.templateId), request.id)
    },
  )

  app.post(
    '/agent-templates/:templateId/update',
    {
      schema: {
        params: templateParamsSchema,
        body: updateTemplateBodySchema,
        response: { 200: templateDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.updateTemplate(user, request.params.templateId, request.body), request.id)
    },
  )

  app.post(
    '/agent-templates/:templateId/duplicate',
    {
      schema: {
        params: templateParamsSchema,
        body: duplicateTemplateBodySchema,
        response: { 200: templateDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.duplicateTemplate(user, request.params.templateId, request.body.name),
        request.id,
      )
    },
  )

  app.get(
    '/agent-templates/:templateId/versions',
    {
      schema: {
        params: templateParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: templateVersionPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.listTemplateVersions(
          user,
          request.params.templateId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/agent-templates/:templateId/versions/:templateVersionId',
    {
      schema: {
        params: templateVersionParamsSchema,
        response: { 200: templateVersionDetailResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.getTemplateVersion(user, request.params.templateId, request.params.templateVersionId),
        request.id,
      )
    },
  )

  app.get(
    '/agent-templates/:templateId/activities',
    {
      schema: {
        params: templateParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: activityPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.listTemplateActivities(
          user,
          request.params.templateId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/agent-templates/:templateId/snapshot-links',
    {
      schema: {
        params: templateParamsSchema,
        response: { 200: snapshotLinkCreatedResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createTemplateSnapshotLink(user, request.params.templateId), request.id)
    },
  )

  app.get(
    '/template-snapshot-links/:token',
    { schema: { params: snapshotTokenParamsSchema, response: { 200: templateSnapshotResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getTemplateSnapshot(user, request.params.token), request.id)
    },
  )

  // 项目模板选用
  app.get(
    '/projects/:projectId/agent-template',
    { schema: { params: projectParamsSchema, response: { 200: projectTemplateSelectionResponseSchema } } },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getProjectTemplate(user, request.params.projectId), request.id)
    },
  )

  app.post(
    '/projects/:projectId/agent-template/apply',
    {
      schema: {
        params: projectParamsSchema,
        body: applyProjectTemplateBodySchema,
        response: { 200: projectTemplateSelectionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.applyProjectTemplate(user, request.params.projectId, request.body),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/agent-template/clear',
    {
      schema: {
        params: projectParamsSchema,
        body: clearProjectTemplateBodySchema,
        response: { 200: projectTemplateSelectionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.clearProjectTemplate(user, request.params.projectId, request.body.version),
        request.id,
      )
    },
  )
}
