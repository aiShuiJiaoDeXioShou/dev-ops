import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.js'
import { requireSessionUser, type IdentityAuth } from '../identity/public.js'
import type { CodeService } from './code.service.js'
import {
  availableRepositoryListResponseSchema,
  codeReferenceParamsSchema,
  codeReferenceResponseSchema,
  createReferenceBodySchema,
  linkRepositoryBodySchema,
  projectParamsSchema,
  projectRepositoryParamsSchema,
  removeReferenceBodySchema,
  removedResponseSchema,
  repositoryListResponseSchema,
  repositoryQuerySchema,
  unlinkRepositoryBodySchema,
} from './code.schema.js'

/** 项目仓库与代码引用路由。 */
export const codeRoutes: FastifyPluginAsyncTypebox<{ auth: IdentityAuth; service: CodeService }> = async (
  app,
  options,
) => {
  app.get(
    '/projects/:projectId/repositories',
    {
      schema: { params: projectParamsSchema, response: { 200: repositoryListResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.listProjectRepositories(user, request.params.projectId), request.id)
    },
  )

  app.get(
    '/projects/:projectId/repositories/available',
    {
      schema: {
        params: projectParamsSchema,
        querystring: repositoryQuerySchema,
        response: { 200: availableRepositoryListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.listAvailableRepositories(user, request.params.projectId, request.query),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/repositories',
    {
      schema: {
        params: projectParamsSchema,
        body: linkRepositoryBodySchema,
        response: { 200: repositoryListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.linkRepository(user, request.params.projectId, request.body.repositoryId),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/repositories/:repositoryId/remove',
    {
      schema: {
        params: projectRepositoryParamsSchema,
        body: unlinkRepositoryBodySchema,
        response: { 200: repositoryListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.unlinkRepository(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.body.reason,
        ),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/code-references',
    {
      schema: {
        params: projectParamsSchema,
        body: createReferenceBodySchema,
        response: { 200: codeReferenceResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createReference(user, request.params.projectId, request.body), request.id)
    },
  )

  app.post(
    '/code-references/:codeReferenceId/refresh',
    {
      schema: { params: codeReferenceParamsSchema, response: { 200: codeReferenceResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.refreshReference(user, request.params.codeReferenceId), request.id)
    },
  )

  app.post(
    '/code-references/:codeReferenceId/remove',
    {
      schema: {
        params: codeReferenceParamsSchema,
        body: removeReferenceBodySchema,
        response: { 200: removedResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      await options.service.removeReference(user, request.params.codeReferenceId, request.body.reason)
      return success({ removed: true }, request.id)
    },
  )
}
