import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireSessionUser } from '../identity/identity.session.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import type { ProjectsService } from './projects.service.ts'
import {
  createProjectBodySchema,
  projectListQuerySchema,
  projectListResponseSchema,
  projectParamsSchema,
  projectResponseSchema,
  projectStatsResponseSchema,
  projectTeamParamsSchema,
  updateProjectBodySchema,
} from './projects.schema.ts'

/** 项目列表/详情/更新/统计路由。 */
export const projectRoutes: FastifyPluginAsyncTypebox<{ auth: IdentityAuth; service: ProjectsService }> = async (
  app,
  options,
) => {
  app.get(
    '/teams/:teamId/projects',
    {
      schema: {
        params: projectTeamParamsSchema,
        querystring: projectListQuerySchema,
        response: { 200: projectListResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.listProjects(user, request.params.teamId, request.query), request.id)
    },
  )

  app.post(
    '/teams/:teamId/projects',
    {
      schema: {
        params: projectTeamParamsSchema,
        body: createProjectBodySchema,
        response: { 200: projectResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createProject(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId',
    {
      schema: { params: projectParamsSchema, response: { 200: projectResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getProject(user, request.params.projectId), request.id)
    },
  )

  app.post(
    '/projects/:projectId/update',
    {
      schema: {
        params: projectParamsSchema,
        body: updateProjectBodySchema,
        response: { 200: projectResponseSchema },
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.updateProject(user, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId/stats',
    {
      schema: { params: projectParamsSchema, response: { 200: projectStatsResponseSchema } },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.getStats(user, request.params.projectId), request.id)
    },
  )
}
