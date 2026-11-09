import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.js'
import { requireSessionUser, type IdentityAuth } from '../identity/public.js'
import type { BugsService } from './bugs.service.js'
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
} from './bugs.schema.js'

/** Bug 列表、详情、状态动作、关联、评论与活动路由。 */
export const bugRoutes: FastifyPluginAsyncTypebox<{ auth: IdentityAuth; service: BugsService }> = async (
  app,
  options,
) => {
  app.get(
    '/projects/:projectId/bugs',
    {
      schema: {
        params: projectBugParamsSchema,
        querystring: bugsQuerySchema,
        response: { 200: bugListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.listBugs(user, request.params.projectId, request.query), request.id)
    },
  )

  app.post(
    '/projects/:projectId/bugs',
    {
      schema: { params: projectBugParamsSchema, body: createBugBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createBug(user, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/bugs/:bugId',
    {
      schema: { params: bugParamsSchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getBug(user, request.params.bugId), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/update',
    {
      schema: { params: bugParamsSchema, body: updateBugBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.updateBug(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/start-fix',
    {
      schema: { params: bugParamsSchema, body: startFixBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.startFix(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/submit-regression',
    {
      schema: {
        params: bugParamsSchema,
        body: submitRegressionBodySchema,
        response: { 200: submitRegressionResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.submitRegression(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/withdraw-regression',
    {
      schema: { params: bugParamsSchema, body: withdrawRegressionBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.withdrawRegression(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/record-regression',
    {
      schema: { params: bugParamsSchema, body: recordRegressionBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.recordRegression(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/close',
    {
      schema: { params: bugParamsSchema, body: closeBugBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.closeBug(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/reopen',
    {
      schema: { params: bugParamsSchema, body: reopenBugBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.reopenBug(user, request.params.bugId, request.body), request.id)
    },
  )

  app.post(
    '/bugs/:bugId/requirements',
    {
      schema: { params: bugParamsSchema, body: linkRequirementBodySchema, response: { 200: bugResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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
        params: bugRequirementParamsSchema,
        body: unlinkRequirementBodySchema,
        response: { 200: bugResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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
      schema: { params: bugParamsSchema, querystring: pageQuerySchema, response: { 200: commentPageResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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
      schema: { params: bugParamsSchema, body: commentBodySchema, response: { 200: commentResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.addComment(user, request.params.bugId, request.body.bodyMarkdown),
        request.id,
      )
    },
  )

  app.get(
    '/bugs/:bugId/activities',
    {
      schema: { params: bugParamsSchema, querystring: pageQuerySchema, response: { 200: activityPageResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
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
