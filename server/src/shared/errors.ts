import type { FastifyError, FastifyInstance } from 'fastify'
import { Type } from 'typebox'

export const errorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  requestId: Type.String(),
}, { $id: 'ErrorResponse' })

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
