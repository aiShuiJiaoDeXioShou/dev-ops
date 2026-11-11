import type { FastifyError, FastifyInstance } from 'fastify'
import { ERROR_CODES, type ErrorCode } from './error-codes.ts'
import { failure, failureEnvelopeSchema } from './response.ts'

/**
 * 业务可预期的 API 错误。
 *
 * 抛出后由统一错误处理器转换为 HTTP 200 + 失败信封；不要把可预期业务结果
 * 表达为 4xx/5xx。`message` 必须面向用户且不含内部细节。
 */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly data: unknown

  /**
   * 创建业务错误。
   * @param code 已登记的业务错误码。
   * @param message 用户可读中文说明。
   * @param data 可选的结构化错误信息。
   * @returns 可供 service 层抛出的错误实例。
   */
  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
  }
}

function isApiPath(url: string): boolean {
  return url === '/api/v1' || url.startsWith('/api/v1/') || url.startsWith('/api/v1?')
}

function mapHttpStatus(statusCode: number): ErrorCode {
  switch (statusCode) {
    case 400:
      return ERROR_CODES.VALIDATION_ERROR
    case 401:
      return ERROR_CODES.UNAUTHENTICATED
    case 403:
      return ERROR_CODES.FORBIDDEN
    case 404:
      return ERROR_CODES.NOT_FOUND
    case 409:
      return ERROR_CODES.PRECONDITION_FAILED
    case 413:
      return ERROR_CODES.VALIDATION_ERROR
    default:
      return ERROR_CODES.INTERNAL_ERROR
  }
}

function sendFailure(reply: import('fastify').FastifyReply, statusCode: number, body: unknown) {
  // 错误可能在路由 schema 序列化阶段被拒绝；信封使用独立序列化器，保证错误格式稳定。
  return reply
    .code(statusCode)
    .type('application/json')
    .serializer((payload) => JSON.stringify(payload))
    .send(body)
}

/**
 * 注册公共错误 schema 及 HTTP 错误处理。
 * @param app 尚未启动的 Fastify 应用。
 * @returns 无返回值；注册 404 和异常响应，并在服务端记录内部错误。
 * @remarks 自研 /api/v1 路径的业务错误统一返回 HTTP 200 + 失败信封；
 * 文档等非业务路径保留 404；未处理异常仍返回 500，避免掩盖进程级故障。
 */
export function registerErrorHandlers(app: FastifyInstance) {
  app.addSchema(failureEnvelopeSchema)

  app.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url)) {
      return sendFailure(reply, 200, failure(ERROR_CODES.NOT_FOUND, '接口不存在', request.id))
    }
    return sendFailure(reply, 404, failure(ERROR_CODES.NOT_FOUND, '接口不存在', request.id))
  })

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendFailure(reply, 200, failure(error.code, error.message, request.id, error.data))
    }

    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500

    if (error.validation) {
      return sendFailure(
        reply,
        200,
        failure(ERROR_CODES.VALIDATION_ERROR, '请求参数不合法', request.id, error.validation),
      )
    }

    if (statusCode < 500) {
      return sendFailure(reply, 200, failure(mapHttpStatus(statusCode), '请求无法完成', request.id))
    }

    // 不记录原始 error：Drizzle/Fastify 的错误消息可能包含完整 SQL、绑定参数与内部堆栈，
    // 只保留可检索的错误类型与请求上下文，具体排查用 requestId 关联。
    request.log.error(
      {
        errorName: error.name,
        errorCode: typeof error.code === 'string' ? error.code : undefined,
        method: request.method,
        url: request.url,
      },
      'Request failed',
    )
    return sendFailure(reply, 500, failure(ERROR_CODES.INTERNAL_ERROR, '服务内部错误', request.id))
  })
}
