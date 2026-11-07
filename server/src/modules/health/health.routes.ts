import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { healthResponseSchema, readinessResponseSchema } from './health.schema.js'

/**
 * 注册独立的进程存活与数据库就绪接口。
 * @param app Fastify 插件实例，必须已注册 ErrorResponse schema。
 * @param options 数据库探测函数，成功完成表示数据库与 app schema 可用。
 * @returns 注册完成的 Promise；数据库失败返回 503，不向客户端暴露内部错误。
 */
export const healthRoutes: FastifyPluginAsyncTypebox<{
  checkDatabase: () => Promise<void>
}> = async (app, options) => {
  app.get('/health', {
    schema: {
      tags: ['health'],
      summary: '检查 API 进程是否存活',
      response: {
        200: healthResponseSchema,
        500: { $ref: 'ErrorResponse#' },
      },
    },
  }, async () => ({ status: 'ok' as const }))

  app.get('/ready', {
    schema: {
      tags: ['health'],
      summary: '检查数据库连接及 app schema 访问权限',
      response: {
        200: readinessResponseSchema,
        503: { $ref: 'ErrorResponse#' },
      },
    },
  }, async (request, reply) => {
    try {
      await options.checkDatabase()
      return { status: 'ok' as const, database: 'ok' as const }
    } catch {
      request.log.warn('数据库就绪检查失败')
      return reply.code(503).send({
        code: 'DATABASE_UNAVAILABLE',
        message: '数据库暂不可用',
        requestId: request.id,
      })
    }
  })
}
