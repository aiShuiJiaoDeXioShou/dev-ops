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
  projectArtifactListQuerySchema,
  projectArtifactListResponseSchema,
  projectParamsSchema,
  projectServiceParamsSchema,
  releaseListQuerySchema,
  releaseListResponseSchema,
  releaseViewResponseSchema,
  reportBuildBodySchema,
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
        summary: '上报项目构建',
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
        summary: '读取项目构建列表',
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
      schema: { summary: '读取构建详情', params: buildParamsSchema, response: { 200: buildResponseSchema } },
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
        summary: '更正构建信息',
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
        summary: '为构建登记产物',
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
        summary: '关联构建交付目标',
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
        summary: '移除构建交付目标',
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
        summary: '读取项目产物列表',
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
        summary: '读取服务运行版本',
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
        summary: '读取服务环境版本历史',
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
        summary: '确认服务环境运行版本',
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
    '/projects/:projectId/reviews',
    {
      schema: {
        summary: '登记外部审核',
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
        summary: '更新外部审核记录',
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
        summary: '读取项目外部审核列表',
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
      schema: { summary: '读取外部审核详情', params: reviewParamsSchema, response: { 200: reviewViewResponseSchema } },
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
        summary: '登记项目发布',
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
        summary: '读取项目发布列表',
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
