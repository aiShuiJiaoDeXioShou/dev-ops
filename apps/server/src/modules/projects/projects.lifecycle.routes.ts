import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { apiResponseSchema, success } from '../../platform/http/response.ts'
import { requireHumanActor, requireSessionActor } from '../identity/identity.actor.ts'
import { projectParamsSchema, projectTeamParamsSchema } from './projects.schema.ts'
import type { createProjectLifecycleService } from './projects.lifecycle.service.ts'

const id = Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })
const version = Type.Integer({ minimum: 1, maximum: 2147483646 })
const cleanupStatus = Type.Union([
  Type.Literal('none'),
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
])
const pageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
const recycleResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(Type.Object({ id, name: Type.String(), version, deletedAt: Type.String(), cleanupStatus })),
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
  }),
)
const projectResponse = apiResponseSchema(Type.Object({ id }))
const cleanupResponse = apiResponseSchema(Type.Object({ id, cleanupStatus }))
const passwordBody = Type.Object(
  { version, password: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
)
const restoreBody = Type.Object({ version }, { additionalProperties: false })

/**
 * 注册回收站、项目软删除、恢复及文件清理端点。
 * @param app Fastify 插件实例。
 * @param options.service 项目生命周期用例。
 * @returns 路由注册完成的 Promise。
 */
export const projectLifecycleRoutes: FastifyPluginAsyncTypebox<{
  service: ReturnType<typeof createProjectLifecycleService>
}> = async (app, { service }) => {
  app.get(
    '/teams/:teamId/project-recycle-bin',
    {
      schema: { params: projectTeamParamsSchema, querystring: pageQuery, response: { 200: recycleResponse } },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(
        await service.list(user, request.params.teamId, request.query.page ?? 1, request.query.pageSize ?? 20),
        request.id,
      )
    },
  )
  app.post(
    '/projects/:projectId/remove',
    {
      // 通用幂等钩子会对请求体生成摘要，密码验证请求必须跳过。
      config: { idempotency: false },
      schema: { params: projectParamsSchema, body: passwordBody, response: { 200: projectResponse } },
    },
    async (request) => {
      const user = await requireSessionActor(request, '删除项目')
      return success(
        await service.remove(user, request.params.projectId, request.body.version, {
          password: request.body.password,
          headers: request.headers,
        }),
        request.id,
      )
    },
  )
  app.post(
    '/projects/:projectId/restore',
    {
      schema: { params: projectParamsSchema, body: restoreBody, response: { 200: projectResponse } },
    },
    async (request) => {
      const user = await requireHumanActor(request)
      return success(await service.restore(user, request.params.projectId, request.body.version), request.id)
    },
  )
  app.post(
    '/projects/:projectId/cleanup-files',
    {
      config: { idempotency: false },
      schema: { params: projectParamsSchema, body: passwordBody, response: { 200: cleanupResponse } },
    },
    async (request) => {
      const user = await requireSessionActor(request, '清理项目文件')
      return success(
        await service.cleanup(user, request.params.projectId, request.body.version, {
          password: request.body.password,
          headers: request.headers,
        }),
        request.id,
      )
    },
  )
}
