import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import type { CodeService } from './code.service.ts'
import {
  availableRepositoryListResponseSchema,
  codeReferenceParamsSchema,
  codeReferenceResponseSchema,
  commitListQuerySchema,
  commitListResponseSchema,
  commitRefParamsSchema,
  commitResponseSchema,
  createReferenceBodySchema,
  linkRepositoryBodySchema,
  projectParamsSchema,
  projectRepositoryParamsSchema,
  pullRequestDiffResponseSchema,
  pullRequestListQuerySchema,
  pullRequestListResponseSchema,
  pullRequestParamsSchema,
  pullRequestResponseSchema,
  removeReferenceBodySchema,
  removedResponseSchema,
  repositoryFileQuerySchema,
  repositoryFileResponseSchema,
  repositoryBranchesResponseSchema,
  repositoryListResponseSchema,
  repositoryQuerySchema,
  repositoryTreeQuerySchema,
  repositoryTreeResponseSchema,
  unlinkRepositoryBodySchema,
} from './code.schema.ts'

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
      const user = await requireActor(request)
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
      const user = await requireActor(request)
      return success(
        await options.service.listAvailableRepositories(user, request.params.projectId, request.query),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/branches',
    {
      schema: { params: projectRepositoryParamsSchema, response: { 200: repositoryBranchesResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        {
          branches: await options.service.listRepositoryBranches(
            user,
            request.params.projectId,
            request.params.repositoryId,
          ),
        },
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/tree',
    {
      schema: {
        params: projectRepositoryParamsSchema,
        querystring: repositoryTreeQuerySchema,
        response: { 200: repositoryTreeResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listRepositoryTree(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.query.branch,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/file',
    {
      schema: {
        params: projectRepositoryParamsSchema,
        querystring: repositoryFileQuerySchema,
        response: { 200: repositoryFileResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.getRepositoryFile(user, request.params.projectId, request.params.repositoryId, {
          branch: request.query.branch,
          path: request.query.path,
        }),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/commits',
    {
      schema: {
        params: projectRepositoryParamsSchema,
        querystring: commitListQuerySchema,
        response: { 200: commitListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listRepositoryCommits(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.query,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/commits/:ref',
    {
      schema: {
        params: commitRefParamsSchema,
        response: { 200: commitResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.getRepositoryCommit(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.params.ref,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/pull-requests',
    {
      schema: {
        params: projectRepositoryParamsSchema,
        querystring: pullRequestListQuerySchema,
        response: { 200: pullRequestListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.listRepositoryPullRequests(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.query,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/pull-requests/:number',
    {
      schema: {
        params: pullRequestParamsSchema,
        response: { 200: pullRequestResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.getRepositoryPullRequest(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.params.number,
        ),
        request.id,
      )
    },
  )

  app.get(
    '/projects/:projectId/repositories/:repositoryId/pull-requests/:number/diff',
    {
      schema: {
        params: pullRequestParamsSchema,
        response: { 200: pullRequestDiffResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.getRepositoryPullRequestDiff(
          user,
          request.params.projectId,
          request.params.repositoryId,
          request.params.number,
        ),
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
      const user = await requireActor(request)
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
      const user = await requireActor(request)
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
      const user = await requireActor(request)
      return success(await options.service.createReference(user, request.params.projectId, request.body), request.id)
    },
  )

  app.post(
    '/code-references/:codeReferenceId/refresh',
    {
      schema: { params: codeReferenceParamsSchema, response: { 200: codeReferenceResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
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
      const user = await requireActor(request)
      await options.service.removeReference(user, request.params.codeReferenceId, request.body.reason)
      return success({ removed: true }, request.id)
    },
  )
}
