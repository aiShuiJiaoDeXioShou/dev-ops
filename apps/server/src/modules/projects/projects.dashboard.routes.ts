import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { ProjectDashboardService } from './projects.dashboard.service.ts'
import {
  projectActivityQuerySchema,
  projectActivityResponseSchema,
  projectActivityTeamParamsSchema,
} from './projects.dashboard.schema.ts'

/** 项目首页晴雨表路由。 */
export const projectDashboardRoutes: FastifyPluginAsyncTypebox<{ service: ProjectDashboardService }> = async (
  app,
  options,
) => {
  app.get(
    '/teams/:teamId/project-activity',
    {
      schema: {
        params: projectActivityTeamParamsSchema,
        querystring: projectActivityQuerySchema,
        response: { 200: projectActivityResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.getProjectActivity(actor, request.params.teamId, request.query), request.id)
    },
  )
}
