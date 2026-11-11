import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { OperationsService } from './operations.service.ts'
import {
  approveChangePlanBodySchema,
  cancelChangePlanBodySchema,
  cancelChangePlanResponseSchema,
  changePlanDetailResponseSchema,
  changePlanEventListResponseSchema,
  changePlanEventQuerySchema,
  changePlanListQuerySchema,
  changePlanListResponseSchema,
  changePlanParamsSchema,
  changeExecutionListResponseSchema,
  changePlanProjectParamsSchema,
  changePlanTeamParamsSchema,
  createChangePlanBodySchema,
  executeChangePlanBodySchema,
  executeChangePlanResponseSchema,
  retryChangePlanBodySchema,
  retryChangePlanResponseSchema,
  updateChangePlanBodySchema,
  verifyChangePlanBodySchema,
  verifyChangePlanResponseSchema,
} from './operations.schema.ts'

/** 变更计划路由：创建、列表、详情、修改、放行与取消。 */
export const operationsRoutes: FastifyPluginAsyncTypebox<{ service: OperationsService }> = async (app, options) => {
  app.post(
    '/projects/:projectId/change-plans',
    {
      schema: {
        params: changePlanProjectParamsSchema,
        body: createChangePlanBodySchema,
        response: { 200: changePlanDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.createPlan(actor, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/teams/:teamId/change-plans',
    {
      schema: {
        params: changePlanTeamParamsSchema,
        querystring: changePlanListQuerySchema,
        response: { 200: changePlanListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.listPlans(actor, request.params.teamId, request.query), request.id)
    },
  )

  app.get(
    '/change-plans/:planId',
    {
      schema: { params: changePlanParamsSchema, response: { 200: changePlanDetailResponseSchema } },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.getPlan(actor, request.params.planId), request.id)
    },
  )

  app.post(
    '/change-plans/:planId/update',
    {
      schema: {
        params: changePlanParamsSchema,
        body: updateChangePlanBodySchema,
        response: { 200: changePlanDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.updatePlan(actor, request.params.planId, request.body), request.id)
    },
  )

  app.post(
    '/change-plans/:planId/approve',
    {
      schema: {
        params: changePlanParamsSchema,
        body: approveChangePlanBodySchema,
        response: { 200: changePlanDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.approvePlan(actor, request.params.planId, request.body), request.id)
    },
  )

  app.post(
    '/change-plans/:planId/execute',
    {
      schema: {
        params: changePlanParamsSchema,
        body: executeChangePlanBodySchema,
        response: { 200: executeChangePlanResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.executePlan(actor, request.params.planId, request.body), request.id)
    },
  )

  app.post(
    '/change-plans/:planId/verify',
    {
      schema: {
        params: changePlanParamsSchema,
        body: verifyChangePlanBodySchema,
        response: { 200: verifyChangePlanResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.verifyPlan(actor, request.params.planId, request.body), request.id)
    },
  )

  app.post(
    '/change-plans/:planId/retry',
    {
      schema: {
        params: changePlanParamsSchema,
        body: retryChangePlanBodySchema,
        response: { 200: retryChangePlanResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.retryPlan(actor, request.params.planId, request.body), request.id)
    },
  )

  app.get(
    '/change-plans/:planId/events',
    {
      schema: {
        params: changePlanParamsSchema,
        querystring: changePlanEventQuerySchema,
        response: { 200: changePlanEventListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.listEventsPage(actor, request.params.planId, request.query), request.id)
    },
  )

  app.get(
    '/change-plans/:planId/executions',
    {
      schema: { params: changePlanParamsSchema, response: { 200: changeExecutionListResponseSchema } },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success({ items: await options.service.listExecutions(actor, request.params.planId) }, request.id)
    },
  )

  app.post(
    '/change-plans/:planId/cancel',
    {
      schema: {
        params: changePlanParamsSchema,
        body: cancelChangePlanBodySchema,
        response: { 200: cancelChangePlanResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.cancelPlan(actor, request.params.planId, request.body), request.id)
    },
  )
}
