import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { DeliveryService, ReporterKind } from './delivery.service.ts'
import {
  addArtifactBodySchema,
  buildListQuerySchema,
  buildListResponseSchema,
  buildParamsSchema,
  buildResponseSchema,
  buildTargetParamsSchema,
  confirmRunVersionBodySchema,
  correctBuildBodySchema,
  createReleaseBodySchema,
  createReviewBodySchema,
  linkTargetBodySchema,
  pipelineRunDetailResponseSchema,
  pipelineRunListQuerySchema,
  pipelineRunListResponseSchema,
  pipelineRunParamsSchema,
  projectArtifactListQuerySchema,
  projectArtifactListResponseSchema,
  projectParamsSchema,
  projectServiceParamsSchema,
  releaseListQuerySchema,
  releaseListResponseSchema,
  releaseViewResponseSchema,
  reportBuildBodySchema,
  reportPipelineRunBodySchema,
  reviewListQuerySchema,
  reviewListResponseSchema,
  reviewParamsSchema,
  reviewViewResponseSchema,
  runVersionHistoryQuerySchema,
  runVersionHistoryResponseSchema,
  runVersionListResponseSchema,
  runVersionParamsSchema,
  runVersionViewResponseSchema,
  unlinkTargetBodySchema,
  updateReviewBodySchema,
} from './delivery.schema.ts'

/** 判断请求是否使用 Bearer Token，用于记录上报者类型。 */
function reporterKindOf(authorization: string | undefined): ReporterKind {
  return authorization?.toLowerCase().startsWith('bearer ') ? 'api_token' : 'web'
}

/** 构建记录、产物引用与事项关联路由。 */
export const deliveryRoutes: FastifyPluginAsyncTypebox<{ service: DeliveryService }> = async (app, options) => {
  app.post(
    '/projects/:projectId/builds',
    {
      schema: {
        params: projectParamsSchema,
        body: reportBuildBodySchema,
        response: { 200: buildResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.reportBuild(
          actor,
          request.params.projectId,
          request.body,
          reporterKindOf(request.headers.authorization),
        ),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/builds',
    {
      schema: {
        params: projectParamsSchema,
        querystring: buildListQuerySchema,
        response: { 200: buildListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.listBuilds(actor, request.params.projectId, {
          ...request.query,
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/builds/:buildId',
    {
      schema: { params: buildParamsSchema, response: { 200: buildResponseSchema } },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.getBuild(actor, request.params.buildId), request.id)
    },
  )

  app.post(
    '/builds/:buildId/correct',
    {
      schema: {
        params: buildParamsSchema,
        body: correctBuildBodySchema,
        response: { 200: buildResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.correctBuild(actor, request.params.buildId, request.body), request.id)
    },
  )

  app.post(
    '/builds/:buildId/artifacts',
    {
      schema: {
        params: buildParamsSchema,
        body: addArtifactBodySchema,
        response: { 200: buildResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.addArtifact(actor, request.params.buildId, request.body), request.id)
    },
  )

  app.post(
    '/builds/:buildId/targets',
    {
      schema: {
        params: buildParamsSchema,
        body: linkTargetBodySchema,
        response: { 200: buildResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.linkTarget(actor, request.params.buildId, request.body), request.id)
    },
  )

  app.post(
    '/builds/:buildId/targets/:targetId/remove',
    {
      schema: {
        params: buildTargetParamsSchema,
        body: unlinkTargetBodySchema,
        response: { 200: buildResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.unlinkTarget(actor, request.params.buildId, request.params.targetId, request.body.reason),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/artifacts',
    {
      schema: {
        params: projectParamsSchema,
        querystring: projectArtifactListQuerySchema,
        response: { 200: projectArtifactListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.listProjectArtifacts(actor, request.params.projectId, {
          serviceId: request.query.serviceId,
          environment: request.query.environment,
          artifactType: request.query.artifactType,
          latest: request.query.latest === 'true',
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/services/:serviceId/run-versions',
    {
      schema: {
        params: projectServiceParamsSchema,
        response: { 200: runVersionListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      const views = await options.service.listRunVersions(actor, request.params.projectId, request.params.serviceId)
      return success({ items: views, page: 1, pageSize: views.length, total: views.length }, request.id)
    },
  )

  app.get(
    '/projects/:projectId/services/:serviceId/run-versions/:environment/history',
    {
      schema: {
        params: runVersionParamsSchema,
        querystring: runVersionHistoryQuerySchema,
        response: { 200: runVersionHistoryResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.listRunVersionHistory(
          actor,
          request.params.projectId,
          request.params.serviceId,
          request.params.environment,
          request.query.page ?? 1,
          request.query.pageSize ?? 20,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/services/:serviceId/run-versions/:environment/confirm',
    {
      schema: {
        params: runVersionParamsSchema,
        body: confirmRunVersionBodySchema,
        response: { 200: runVersionViewResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.confirmRunVersion(
          actor,
          request.params.projectId,
          request.params.serviceId,
          request.params.environment,
          request.body,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/pipeline-runs',
    {
      schema: {
        params: projectParamsSchema,
        body: reportPipelineRunBodySchema,
        response: { 200: pipelineRunDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.reportPipelineRun(actor, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId/pipeline-runs',
    {
      schema: {
        params: projectParamsSchema,
        querystring: pipelineRunListQuerySchema,
        response: { 200: pipelineRunListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.listPipelineRuns(actor, request.params.projectId, {
          serviceId: request.query.serviceId,
          status: request.query.status,
          from: request.query.from,
          to: request.query.to,
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/pipeline-runs/:runId',
    {
      schema: {
        params: pipelineRunParamsSchema,
        response: { 200: pipelineRunDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.getPipelineRun(actor, request.params.runId), request.id)
    },
  )

  app.post(
    '/projects/:projectId/reviews',
    {
      schema: {
        params: projectParamsSchema,
        body: createReviewBodySchema,
        response: { 200: reviewViewResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.createReview(actor, request.params.projectId, request.body), request.id)
    },
  )

  app.post(
    '/reviews/:reviewId/update',
    {
      schema: {
        params: reviewParamsSchema,
        body: updateReviewBodySchema,
        response: { 200: reviewViewResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.updateReview(actor, request.params.reviewId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId/reviews',
    {
      schema: {
        params: projectParamsSchema,
        querystring: reviewListQuerySchema,
        response: { 200: reviewListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.listReviews(actor, request.params.projectId, {
          serviceId: request.query.serviceId,
          targetType: request.query.targetType,
          reviewStatus: request.query.reviewStatus,
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/reviews/:reviewId',
    {
      schema: {
        params: reviewParamsSchema,
        response: { 200: reviewViewResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.getReview(actor, request.params.reviewId), request.id)
    },
  )

  app.post(
    '/projects/:projectId/releases',
    {
      schema: {
        params: projectParamsSchema,
        body: createReleaseBodySchema,
        response: { 200: releaseViewResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.createRelease(actor, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId/releases',
    {
      schema: {
        params: projectParamsSchema,
        querystring: releaseListQuerySchema,
        response: { 200: releaseListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        await options.service.listReleases(actor, request.params.projectId, {
          serviceId: request.query.serviceId,
          releaseStatus: request.query.releaseStatus,
          reviewId: request.query.reviewId,
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
        request.id,
      )
    },
  )
}
