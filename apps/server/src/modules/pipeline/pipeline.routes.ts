import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { FastifyRequest } from 'fastify'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { success } from '../../platform/http/response.ts'
import type { Actor } from '../identity/identity.actor.ts'
import { resolveActor } from '../identity/identity.actor.ts'
import { resolveLogAfterSeq, type PipelineService } from './pipeline.service.ts'
import {
  pipelineArtifactListResponseSchema,
  pipelineArtifactParamsSchema,
  pipelineCancelBodySchema,
  pipelineCreateNodeBodySchema,
  pipelineCreateNodeResponseSchema,
  pipelineLogQuerySchema,
  pipelineLogResponseSchema,
  pipelineNodeListResponseSchema,
  pipelineNodeParamsSchema,
  pipelineNodeResponseSchema,
  pipelineProjectParamsSchema,
  pipelineRotateTokenResponseSchema,
  pipelineRunDetailResponseSchema,
  pipelineRunListQuerySchema,
  pipelineRunListResponseSchema,
  pipelineRunParamsSchema,
  pipelineTeamParamsSchema,
  pipelineTriggerBodySchema,
  pipelineWorkflowDetailQuerySchema,
  pipelineWorkflowDetailResponseSchema,
  pipelineWorkflowListQuerySchema,
  pipelineWorkflowListResponseSchema,
} from './pipeline.schema.ts'
import type { PipelineNodesService } from './pipeline.nodes.service.ts'

/** 平台流水线路由依赖。 */
export interface PipelineRoutesOptions {
  service: PipelineService
  nodes: PipelineNodesService
}

/** 解析 UTC 日期筛选；语法错误由 schema 拦截，这里只处理非法日历日期。 */
function parseUtcDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '日期筛选不合法')
  return endOfDay ? new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1) : date
}

/** 读取当前请求身份与凭据来源；写操作据此记录 initiatorChannel。 */
async function requireActorWithCredential(request: FastifyRequest): Promise<Actor> {
  const actor = await resolveActor(request.server.auth, request.server.tokenService, request.headers)
  if (!actor) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '请先登录或提供有效 API Token')
  return actor
}

/** 构造 Content-Disposition 附件文件名；中文名使用 UTF-8 编码参数。 */
function contentDisposition(value: string): string {
  const fallback = value.replace(/[^A-Za-z0-9._-]/g, '_') || 'artifact.tar'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(value)}`
}

/**
 * 注册平台流水线控制面路由：工作流、触发、运行、取消、日志、产物与节点管理。
 * @param app Fastify 实例，已挂载 `/api/v1` 前缀。
 * @param options 流水线服务与节点服务。
 * @remarks 产物下载是已登记的文件传输例外：成功返回二进制流，失败仍返回统一 JSON 信封。
 */
export const pipelineRoutes: FastifyPluginAsyncTypebox<PipelineRoutesOptions> = async (app, options) => {
  app.get(
    '/projects/:projectId/pipeline-workflows',
    {
      schema: {
        params: pipelineProjectParamsSchema,
        querystring: pipelineWorkflowListQuerySchema,
        response: { 200: pipelineWorkflowListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success(
        await options.service.listWorkflows(actor.user, request.params.projectId, request.query.ref),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/pipeline-workflows/detail',
    {
      schema: {
        params: pipelineProjectParamsSchema,
        querystring: pipelineWorkflowDetailQuerySchema,
        response: { 200: pipelineWorkflowDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success(
        await options.service.getWorkflowDetail(
          actor.user,
          request.params.projectId,
          request.query.path,
          request.query.ref,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/pipeline-runs',
    {
      schema: {
        params: pipelineProjectParamsSchema,
        body: pipelineTriggerBodySchema,
        response: { 200: pipelineRunDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      const result = await options.service.triggerRun(actor.user, request.params.projectId, {
        workflowPath: request.body.workflowPath,
        ref: request.body.ref,
        inputs: request.body.inputs ?? {},
        idempotencyKey: request.body.idempotencyKey,
        initiatorChannel: actor.credential === 'session' ? 'web' : 'api',
      })
      return success(result.run, request.id, result.created ? '运行已创建' : '已返回幂等键对应的运行')
    },
  )

  app.get(
    '/projects/:projectId/pipeline-runs',
    {
      schema: {
        params: pipelineProjectParamsSchema,
        querystring: pipelineRunListQuerySchema,
        response: { 200: pipelineRunListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      const page = request.query.page ?? 1
      const pageSize = request.query.pageSize ?? 20
      return success(
        await options.service.listRuns(actor.user, request.params.projectId, {
          workflowPath: request.query.workflowPath,
          status: request.query.status,
          from: parseUtcDate(request.query.from, false),
          to: parseUtcDate(request.query.to, true),
          page,
          pageSize,
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
      const actor = await requireActorWithCredential(request)
      return success(await options.service.getRun(actor.user, request.params.runId), request.id)
    },
  )

  app.post(
    '/pipeline-runs/:runId/cancel',
    {
      schema: {
        params: pipelineRunParamsSchema,
        body: pipelineCancelBodySchema,
        response: { 200: pipelineRunDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      const result = await options.service.cancelRun(actor.user, request.params.runId, request.body.reason)
      return success(result.run, request.id)
    },
  )

  app.get(
    '/pipeline-runs/:runId/logs',
    {
      schema: {
        params: pipelineRunParamsSchema,
        querystring: pipelineLogQuerySchema,
        response: { 200: pipelineLogResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success(
        await options.service.readLogs(actor.user, request.params.runId, {
          stepIndex: request.query.stepIndex,
          afterSeq: resolveLogAfterSeq(request.query.afterSeq),
          limit: request.query.limit ?? 20,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/pipeline-runs/:runId/artifacts',
    {
      schema: {
        params: pipelineRunParamsSchema,
        response: { 200: pipelineArtifactListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success(await options.service.listArtifacts(actor.user, request.params.runId), request.id)
    },
  )

  app.get(
    '/pipeline-artifacts/:artifactId/download',
    {
      schema: { params: pipelineArtifactParamsSchema },
    },
    async (request, reply) => {
      const actor = await requireActorWithCredential(request)
      const download = await options.service.openArtifactDownload(actor.user, request.params.artifactId)
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', contentDisposition(download.artifact.name))
        .header('Content-Length', String(download.sizeBytes))
        .header('X-Content-SHA256', download.artifact.sha256)
        .send(download.stream)
    },
  )

  app.get(
    '/teams/:teamId/pipeline-nodes',
    {
      schema: {
        params: pipelineTeamParamsSchema,
        response: { 200: pipelineNodeListResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success({ items: await options.nodes.listNodes(actor.user, request.params.teamId) }, request.id)
    },
  )

  app.post(
    '/teams/:teamId/pipeline-nodes',
    {
      schema: {
        params: pipelineTeamParamsSchema,
        body: pipelineCreateNodeBodySchema,
        response: { 200: pipelineCreateNodeResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success(
        await options.nodes.createNode(actor.user, request.params.teamId, {
          name: request.body.name,
          capabilities: request.body.capabilities,
        }),
        request.id,
      )
    },
  )

  app.post(
    '/pipeline-nodes/:nodeId/drain',
    {
      schema: {
        params: pipelineNodeParamsSchema,
        response: { 200: pipelineNodeResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success({ node: await options.nodes.drainNode(actor.user, request.params.nodeId) }, request.id)
    },
  )

  app.post(
    '/pipeline-nodes/:nodeId/disable',
    {
      schema: {
        params: pipelineNodeParamsSchema,
        response: { 200: pipelineNodeResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success({ node: await options.nodes.disableNode(actor.user, request.params.nodeId) }, request.id)
    },
  )

  app.post(
    '/pipeline-nodes/:nodeId/tokens/rotate',
    {
      schema: {
        params: pipelineNodeParamsSchema,
        response: { 200: pipelineRotateTokenResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActorWithCredential(request)
      return success(await options.nodes.rotateToken(actor.user, request.params.nodeId), request.id)
    },
  )
}
