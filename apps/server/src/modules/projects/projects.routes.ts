import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
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
  serviceListResponseSchema,
  serviceResponseSchema,
  serviceParamsSchema,
  serviceRepositoryParamsSchema,
  createServiceBodySchema,
  updateServiceBodySchema,
  addServiceRepositoryBodySchema,
  removeServiceRepositoryBodySchema,
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
      const user = await requireActor(request)
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
      const user = await requireActor(request)
      return success(await options.service.createProject(user, request.params.teamId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId',
    {
      schema: { params: projectParamsSchema, response: { 200: projectResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
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
      const user = await requireActor(request)
      return success(await options.service.updateProject(user, request.params.projectId, request.body), request.id)
    },
  )

  app.get(
    '/projects/:projectId/stats',
    {
      schema: { params: projectParamsSchema, response: { 200: projectStatsResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.getStats(user, request.params.projectId), request.id)
    },
  )

  app.get(
    '/projects/:projectId/services',
    {
      schema: { params: projectParamsSchema, response: { 200: serviceListResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.listServices(user, request.params.projectId), request.id)
    },
  )

  app.get(
    '/projects/:projectId/services/:serviceId',
    {
      schema: { params: serviceParamsSchema, response: { 200: serviceResponseSchema } },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.getService(user, request.params.serviceId), request.id)
    },
  )

  app.post(
    '/projects/:projectId/services',
    {
      schema: {
        params: projectParamsSchema,
        body: createServiceBodySchema,
        response: { 200: serviceResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.createService(user, request.params.projectId, request.body), request.id)
    },
  )

  app.post(
    '/projects/:projectId/services/:serviceId/update',
    {
      schema: {
        params: serviceParamsSchema,
        body: updateServiceBodySchema,
        response: { 200: serviceResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(await options.service.updateService(user, request.params.serviceId, request.body), request.id)
    },
  )

  app.post(
    '/projects/:projectId/services/:serviceId/repositories',
    {
      schema: {
        params: serviceParamsSchema,
        body: addServiceRepositoryBodySchema,
        response: { 200: serviceResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.addServiceRepository(user, request.params.serviceId, request.body.repositoryId),
        request.id,
      )
    },
  )

  app.post(
    '/projects/:projectId/services/:serviceId/repositories/:repositoryId/remove',
    {
      schema: {
        params: serviceRepositoryParamsSchema,
        body: removeServiceRepositoryBodySchema,
        response: { 200: serviceResponseSchema },
      },
    },
    async (request) => {
      const user = await requireActor(request)
      return success(
        await options.service.removeServiceRepository(
          user,
          request.params.serviceId,
          request.params.repositoryId,
          request.body.reason,
        ),
        request.id,
      )
    },
  )
}
