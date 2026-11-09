import type { FastifyError, FastifyInstance } from 'fastify'
import { Type } from 'typebox'

export const errorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  requestId: Type.String(),
}, { $id: 'ErrorResponse' })

/**
 * 注册公共错误 schema 及 HTTP 错误处理。
 * @param app 尚未启动的 Fastify 应用。
 * @returns 无返回值；注册 404 和异常响应，并在服务端记录内部错误。
 */
export function registerErrorHandlers(app: FastifyInstance) {
  app.addSchema(errorResponseSchema)

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId: request.id,
    })
  })

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 500

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Request failed')
    }

    return reply.code(statusCode).send({
      code: statusCode >= 500
        ? 'INTERNAL_SERVER_ERROR'
        : error.validation ? 'VALIDATION_ERROR' : error.code || 'HTTP_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      requestId: request.id,
    })
  })
}
