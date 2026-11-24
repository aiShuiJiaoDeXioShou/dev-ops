import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import type { BugsService } from './bugs.service.ts'
import {
  activityPageResponseSchema,
  bugListResponseSchema,
  bugParamsSchema,
  bugRequirementParamsSchema,
  bugResponseSchema,
  bugsQuerySchema,
  closeBugBodySchema,
  commentBodySchema,
  commentPageResponseSchema,
  commentResponseSchema,
  createBugBodySchema,
  linkRequirementBodySchema,
  pageQuerySchema,
  projectBugParamsSchema,
  recordRegressionBodySchema,
  reopenBugBodySchema,
  startFixBodySchema,
  submitRegressionBodySchema,
  submitRegressionResponseSchema,
  unlinkRequirementBodySchema,
  updateBugBodySchema,
  withdrawRegressionBodySchema,
} from './bugs.schema.ts'

/** Bug 列表、详情、状态动作、关联、评论与活动路由。 */
export const bugRoutes: FastifyPluginAsyncTypebox<{ auth: IdentityAuth; service: BugsService }> = async (
  app,
  options,
) => {
  app.get(
    '/projects/:projectId/bugs',
    {
      schema: {
        summary: '读取项目 Bug 列表',
        params: projectBugParamsSchema,
        querystring: bugsQuerySchema,
        response: { 200: bugListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listBugs(user, request.params.projectId, request.query), request.id)
    },
  )

  app.post(
    '/projects/:projectId/bugs',
    {
      schema: {
        summary: '创建 Bug',
        params: projectBugParamsSchema,
        body: createBugBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.createBug(user, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/bugs/:bugId',
    {
      schema: { summary: '读取 Bug 详情', params: bugParamsSchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.getBug(user, request.params.bugId), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/update',
    {
      schema: {
        summary: '更新 Bug',
        params: bugParamsSchema,
        body: updateBugBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.updateBug(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/start-fix',
    {
      schema: {
        summary: '开始修复 Bug',
        params: bugParamsSchema,
        body: startFixBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.startFix(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/submit-regression',
    {
      schema: {
        summary: '提交 Bug 回归',
        params: bugParamsSchema,
        body: submitRegressionBodySchema,
        response: { 200: submitRegressionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.submitRegression(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/withdraw-regression',
    {
      schema: {
        summary: '撤回 Bug 回归',
        params: bugParamsSchema,
        body: withdrawRegressionBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.withdrawRegression(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/record-regression',
    {
      schema: {
        summary: '记录 Bug 回归结论',
        params: bugParamsSchema,
        body: recordRegressionBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.recordRegression(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/close',
    {
      schema: {
        summary: '关闭 Bug',
        params: bugParamsSchema,
        body: closeBugBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.closeBug(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/reopen',
    {
      schema: {
        summary: '重新打开 Bug',
        params: bugParamsSchema,
        body: reopenBugBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.reopenBug(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/requirements',
    {
      schema: {
        summary: '关联 Bug 与需求',
        params: bugParamsSchema,
        body: linkRequirementBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.linkRequirement(
          user,
          request.params.bugId,
          request.body.requirementId,
          request.body.version,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/bugs/:bugId/requirements/:requirementId/remove',
    {
      schema: {
        summary: '移除 Bug 关联需求',
        params: bugRequirementParamsSchema,
        body: unlinkRequirementBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.removeRequirementLink(
          user,
          request.params.bugId,
          request.params.requirementId,
          request.body.version,
          request.body.reason,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/bugs/:bugId/comments',
    {
      schema: {
        summary: '读取 Bug 评论',
        params: bugParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: commentPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listComments(
          user,
          request.params.bugId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/bugs/:bugId/comments',
    {
      schema: {
        summary: '追加 Bug 评论',
        params: bugParamsSchema,
        body: commentBodySchema,
        response: { 200: commentResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.addComment(user, request.params.bugId, request.body.bodyMarkdown),
        request.id,
      )
    },
  )

  app.get(
    '/bugs/:bugId/activities',
    {
      schema: {
        summary: '读取 Bug 活动记录',
        params: bugParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: activityPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listActivities(
          user,
          request.params.bugId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )
}
