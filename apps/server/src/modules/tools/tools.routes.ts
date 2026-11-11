import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { listInvocationViews } from './tools.service.ts'
import {
  canManageCapabilityGrants,
  getProjectRoleContext,
  grantToolCapability,
  listCapabilityState,
  listToolCapabilityGrants,
  revokeToolCapability,
} from './tools.capabilities.ts'
import {
  cancelCodeChangeBodySchema,
  cancelCodeChangeResponseSchema,
  codeChangeDiffResponseSchema,
  codeChangeListResponseSchema,
  codeChangeResponseSchema,
  createCodeChangeBodySchema,
  createCodeChangeResponseSchema,
  createPullRequestBodySchema,
  createPullRequestResponseSchema,
  addToolCommentBodySchema,
  addToolCommentResponseSchema,
  createRemoteIssueBodySchema,
  createRemoteIssueResponseSchema,
  toolCapabilitiesResponseSchema,
  toolCodeChangeParamsSchema,
  toolGrantBodySchema,
  toolGrantListResponseSchema,
  toolGrantParamsSchema,
  toolGrantResponseSchema,
  toolGrantRevokeBodySchema,
  toolGrantRevokeResponseSchema,
  toolInvocationListResponseSchema,
  toolProjectParamsSchema,
} from './tools.schema.ts'
import type { CodeChangeService } from './tools.code-change.service.ts'
import type { RemoteWriteService } from './tools.remote-write.service.ts'

/** 项目写能力路由：能力状态、授权管理与受控代码修改。 */
export const toolsRoutes: FastifyPluginAsyncTypebox<{
  db: import('../../platform/database/client.ts').Database
  codeChanges: CodeChangeService
  remoteWrite: RemoteWriteService
}> = async (app, options) => {
  app.get(
    '/projects/:projectId/tools/capabilities',
    { schema: { params: toolProjectParamsSchema, response: { 200: toolCapabilitiesResponseSchema } } },
    async (request) => {
      const actor = await requireActor(request)
      const [capabilities, canManageGrants] = await Promise.all([
        listCapabilityState(options.db, actor, request.params.projectId),
        canManageCapabilityGrants(options.db, actor, request.params.projectId),
      ])
      return success({ capabilities, canManageGrants }, request.id)
    },
  )

  app.get(
    '/projects/:projectId/tools/grants',
    { schema: { params: toolProjectParamsSchema, response: { 200: toolGrantListResponseSchema } } },
    async (request) => {
      const actor = await requireActor(request)
      return success({ items: await listToolCapabilityGrants(options.db, actor, request.params.projectId) }, request.id)
    },
  )

  app.post(
    '/projects/:projectId/tools/grants',
    {
      schema: {
        params: toolProjectParamsSchema,
        body: toolGrantBodySchema,
        response: { 200: toolGrantResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        { grant: await grantToolCapability(options.db, actor, request.params.projectId, request.body) },
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/tools/grants/:grantId/revoke',
    {
      schema: {
        params: toolGrantParamsSchema,
        body: toolGrantRevokeBodySchema,
        response: { 200: toolGrantRevokeResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      await revokeToolCapability(
        options.db,
        actor,
        request.params.projectId,
        request.params.grantId,
        request.body.reason ?? undefined,
      )
      return success({ id: request.params.grantId, revoked: true }, request.id)
    },
  )

  app.post(
    '/projects/:projectId/tools/code-changes',
    {
      config: { idempotency: false },
      schema: {
        params: toolProjectParamsSchema,
        body: createCodeChangeBodySchema,
        response: { 200: createCodeChangeResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      const idempotencyKey = request.headers['idempotency-key']
      const result = await options.codeChanges.createCodeChange(actor, request.params.projectId, {
        ...request.body,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '',
      })
      return success(result, request.id)
    },
  )

  app.get(
    '/projects/:projectId/tools/code-changes',
    { schema: { params: toolProjectParamsSchema, response: { 200: codeChangeListResponseSchema } } },
    async (request) => {
      const actor = await requireActor(request)
      return success({ items: await options.codeChanges.listCodeChanges(actor, request.params.projectId) }, request.id)
    },
  )

  app.get(
    '/projects/:projectId/tools/invocations',
    { schema: { params: toolProjectParamsSchema, response: { 200: toolInvocationListResponseSchema } } },
    async (request) => {
      const actor = await requireActor(request)
      await getProjectRoleContext(options.db, actor, request.params.projectId)
      return success({ items: await listInvocationViews(options.db, request.params.projectId, 50) }, request.id)
    },
  )

  app.get(
    '/tools/code-changes/:codeChangeId',
    { schema: { params: toolCodeChangeParamsSchema, response: { 200: codeChangeResponseSchema } } },
    async (request) => {
      const actor = await requireActor(request)
      return success(
        { codeChange: await options.codeChanges.getCodeChange(actor, request.params.codeChangeId) },
        request.id,
      )
    },
  )

  app.post(
    '/tools/code-changes/:codeChangeId/pull-requests',
    {
      config: { idempotency: false },
      schema: {
        params: toolCodeChangeParamsSchema,
        body: createPullRequestBodySchema,
        response: { 200: createPullRequestResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      const idempotencyKey = request.headers['idempotency-key']
      return success(
        await options.codeChanges.createPullRequestForCodeChange(actor, request.params.codeChangeId, {
          title: request.body.title,
          body: request.body.body ?? '',
          targetBranch: request.body.targetBranch,
          idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '',
        }),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/tools/remote-issues',
    {
      config: { idempotency: false },
      schema: {
        params: toolProjectParamsSchema,
        body: createRemoteIssueBodySchema,
        response: { 200: createRemoteIssueResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      const idempotencyKey = request.headers['idempotency-key']
      return success(
        await options.remoteWrite.createRemoteIssue(actor, request.params.projectId, {
          ...request.body,
          idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '',
        }),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/tools/comments',
    {
      config: { idempotency: false },
      schema: {
        params: toolProjectParamsSchema,
        body: addToolCommentBodySchema,
        response: { 200: addToolCommentResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      const idempotencyKey = request.headers['idempotency-key']
      return success(
        await options.remoteWrite.addToolComment(actor, request.params.projectId, {
          ...request.body,
          idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '',
        }),
        request.id,
      )
    },
  )

  app.get(
    '/tools/code-changes/:codeChangeId/diff',
    { schema: { params: toolCodeChangeParamsSchema, response: { 200: codeChangeDiffResponseSchema } } },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.codeChanges.readDiff(actor, request.params.codeChangeId), request.id)
    },
  )

  app.post(
    '/tools/code-changes/:codeChangeId/cancel',
    {
      schema: {
        params: toolCodeChangeParamsSchema,
        body: cancelCodeChangeBodySchema,
        response: { 200: cancelCodeChangeResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      await options.codeChanges.cancelCodeChange(actor, request.params.codeChangeId, request.body.reason ?? undefined)
      return success({ id: request.params.codeChangeId, cancelled: true }, request.id)
    },
  )
}
