import { Type, type TSchema } from 'typebox'
import { ERROR_CODES, type ErrorCode } from './error-codes.ts'

/** 成功响应固定 code，调用方可据此做类型收窄和日志检索。 */
export const SUCCESS_CODE = ERROR_CODES.OK

export interface SuccessEnvelope<T> {
  success: true
  code: typeof SUCCESS_CODE
  message: string
  requestId: string
  data: T
}

export interface FailureEnvelope {
  success: false
  code: ErrorCode
  message: string
  requestId: string
  data?: unknown
}

/**
 * 构造成功响应信封。
 * @param data 业务数据，可为 null；调用方应只传已筛选的响应字段。
 * @param requestId 当前请求标识，与响应头 x-request-id 一致。
 * @param message 可选的用户可读说明，默认 OK。
 * @returns 统一成功信封，不包含内部对象或敏感字段。
 */
export function success<T>(data: T, requestId: string, message = 'OK'): SuccessEnvelope<T> {
  return { success: true, code: SUCCESS_CODE, message, requestId, data }
}

/**
 * 构造失败响应信封。
 * @param code 已登记的业务错误码。
 * @param message 用户可读中文说明，不得包含堆栈、SQL 或凭据。
 * @param requestId 当前请求标识，与响应头 x-request-id 一致。
 * @param data 可选的字段错误、阻碍项等结构化信息。
 * @returns 统一失败信封；HTTP 状态由调用路径决定，业务错误通常为 200。
 */
export function failure(code: ErrorCode, message: string, requestId: string, data?: unknown): FailureEnvelope {
  return { success: false, code, message, requestId, ...(data === undefined ? {} : { data }) }
}

/** 可被 OpenAPI 引用的失败信封 schema；与错误处理器的输出保持一致。 */
export const failureEnvelopeSchema = Type.Object(
  {
    success: Type.Literal(false),
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    data: Type.Optional(Type.Unknown()),
  },
  { $id: 'ErrorResponse' },
)

/** 失败信封的数据结构（不带 $id），用于路由响应联合类型。 */
export const failurePayloadSchema = Type.Object({
  success: Type.Literal(false),
  code: Type.String(),
  message: Type.String(),
  requestId: Type.String(),
  data: Type.Optional(Type.Unknown()),
})

/**
 * 构造成功信封 schema。
 * @param data 业务数据 schema。
 * @returns 成功信封对象 schema，供 OpenAPI 响应定义使用。
 */
export function successEnvelopeSchema<T extends TSchema>(data: T) {
  return Type.Object({
    success: Type.Literal(true),
    code: Type.Literal('OK'),
    message: Type.String(),
    requestId: Type.String(),
    data,
  })
}

/**
 * 构造路由的 200 响应 schema，同时允许成功与业务失败信封。
 * @param data 成功数据 schema。
 * @returns 成功/失败联合 schema。
 */
export function apiResponseSchema<T extends TSchema>(data: T) {
  return Type.Union([successEnvelopeSchema(data), failurePayloadSchema])
}
