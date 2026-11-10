import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import type { RequirementsService } from './requirements.service.ts'
import {
  activityPageResponseSchema,
  cancelRequirementBodySchema,
  commentBodySchema,
  commentPageResponseSchema,
  commentResponseSchema,
  createRequirementBodySchema,
  eligibilityResponseSchema,
  pageQuerySchema,
  passTestBodySchema,
  projectRequirementParamsSchema,
  requirementListResponseSchema,
  requirementParamsSchema,
  requirementResponseSchema,
  requirementsQuerySchema,
  reopenDevelopmentBodySchema,
  restoreRequirementBodySchema,
  returnToDevelopmentBodySchema,
  startDevelopmentBodySchema,
  startTestBodySchema,
  submitTestBodySchema,
  submitTestResponseSchema,
  testSubmissionPageResponseSchema,
  updateRequirementBodySchema,
  withdrawTestBodySchema,
} from './requirements.schema.ts'

/** 需求列表、详情、创建、更新、评论与活动路由。 */
export const requirementRoutes: FastifyPluginAsyncTypebox<{
  auth: IdentityAuth
  service: RequirementsService
}> = async (app, options) => {
  app.get(
    '/projects/:projectId/requirements',
    {
      schema: {
        params: projectRequirementParamsSchema,
        querystring: requirementsQuerySchema,
        response: { 200: requirementListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listRequirements(user, request.params.projectId, request.query), request.id)
    },
  )

  app.post(
    '/projects/:projectId/requirements',
    {
      schema: {
        params: projectRequirementParamsSchema,
        body: createRequirementBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.createRequirement(user, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/requirements/:requirementId',
    {
      schema: { params: requirementParamsSchema, response: { 200: requirementResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.getRequirement(user, request.params.requirementId), request.id)
    },
  )

  app.post(
    '/requirements/:requirementId/update',
    {
      schema: {
        params: requirementParamsSchema,
        body: updateRequirementBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.updateRequirement(user, request.params.requirementId, request.body),
        request.id,
      )
    },
  )

  app.get(
    '/requirements/:requirementId/comments',
    {
      schema: {
        params: requirementParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: commentPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listComments(
          user,
          request.params.requirementId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/requirements/:requirementId/comments',
    {
      schema: {
        params: requirementParamsSchema,
        body: commentBodySchema,
        response: { 200: commentResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.addComment(user, request.params.requirementId, request.body.bodyMarkdown),
        request.id,
      )
    },
  )

  app.post(
    '/requirements/:requirementId/start-development',
    {
      schema: {
        params: requirementParamsSchema,
        body: startDevelopmentBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.startDevelopment(user, request.params.requirementId, request.body),
        request.id,
      )
    },
  )

  app.post(
    '/requirements/:requirementId/submit-test',
    {
      schema: {
        params: requirementParamsSchema,
        body: submitTestBodySchema,
        response: { 200: submitTestResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      const idempotencyKey =
        typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined
      return success(
        await options.service.submitTest(user, request.params.requirementId, { ...request.body, idempotencyKey }),
        request.id,
      )
    },
  )

  app.post(
    '/requirements/:requirementId/start-test',
    {
      schema: {
        params: requirementParamsSchema,
        body: startTestBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.startTest(user, request.params.requirementId, request.body), request.id)
    },
  )

  app.post(
    '/requirements/:requirementId/withdraw-test',
    {
      schema: {
        params: requirementParamsSchema,
        body: withdrawTestBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.withdrawTest(user, request.params.requirementId, request.body), request.id)
    },
  )

  app.post(
    '/requirements/:requirementId/return-to-development',
    {
      schema: {
        params: requirementParamsSchema,
        body: returnToDevelopmentBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.returnToDevelopment(user, request.params.requirementId, request.body),
        request.id,
      )
    },
  )

  app.get(
    '/requirements/:requirementId/test-pass-eligibility',
    {
      schema: { params: requirementParamsSchema, response: { 200: eligibilityResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.testPassEligibility(user, request.params.requirementId), request.id)
    },
  )

  app.post(
    '/requirements/:requirementId/pass-test',
    {
      schema: {
        params: requirementParamsSchema,
        body: passTestBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.passTest(user, request.params.requirementId, request.body), request.id)
    },
  )

  app.post(
    '/requirements/:requirementId/reopen-development',
    {
      schema: {
        params: requirementParamsSchema,
        body: reopenDevelopmentBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.reopenDevelopment(user, request.params.requirementId, request.body),
        request.id,
      )
    },
  )

  app.post(
    '/requirements/:requirementId/cancel',
    {
      schema: {
        params: requirementParamsSchema,
        body: cancelRequirementBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.cancelRequirement(user, request.params.requirementId, request.body),
        request.id,
      )
    },
  )

  app.post(
    '/requirements/:requirementId/restore',
    {
      schema: {
        params: requirementParamsSchema,
        body: restoreRequirementBodySchema,
        response: { 200: requirementResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.restoreRequirement(user, request.params.requirementId, request.body),
        request.id,
      )
    },
  )

  app.get(
    '/requirements/:requirementId/test-submissions',
    {
      schema: {
        params: requirementParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: testSubmissionPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listTestSubmissions(
          user,
          request.params.requirementId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/requirements/:requirementId/activities',
    {
      schema: {
        params: requirementParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: activityPageResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listActivities(
          user,
          request.params.requirementId,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )
}
