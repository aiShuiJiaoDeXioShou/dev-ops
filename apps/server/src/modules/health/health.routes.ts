import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ERROR_CODES } from '../../platform/http/error-codes.js'
import { failure, success } from '../../platform/http/response.js'
import { healthResponseSchema, readinessResponseSchema } from './health.schema.js'

/**
 * 注册独立的进程存活与数据库就绪接口。
 * @param app Fastify 插件实例，必须已注册 ErrorResponse schema。
 * @param options 数据库探测函数，成功完成表示数据库与 app schema 可用。
 * @returns 注册完成的 Promise；数据库失败也返回 HTTP 200 + 失败信封，不暴露内部错误。
 */
export const healthRoutes: FastifyPluginAsyncTypebox<{
  checkDatabase: () => Promise<void>
}> = async (app, options) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: '检查 API 进程是否存活',
        response: {
          200: healthResponseSchema,
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => success({ status: 'ok' as const }, request.id),
  )

  app.get(
    '/ready',
    {
      schema: {
        tags: ['health'],
        summary: '检查数据库连接及 app schema 访问权限',
        response: {
          200: readinessResponseSchema,
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      try {
        await options.checkDatabase()
        return success({ status: 'ok' as const, database: 'ok' as const }, request.id)
      } catch {
        request.log.warn('数据库就绪检查失败')
        return failure(ERROR_CODES.DATABASE_UNAVAILABLE, '数据库暂不可用', request.id)
      }
    },
  )
}
