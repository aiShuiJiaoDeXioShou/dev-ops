import type { ApiBody, ApiQuery, paths } from './index.ts'
import { validateInput } from './generated/input-validators.mjs'

/**
 * 校验 JSON 写命令输入并收窄为指定接口的请求体。
 * @param path OpenAPI 路径模板。
 * @param value 文件或标准输入读取的未知值。
 * @returns 是否符合请求体结构；仅对带 JSON 请求体的路由有效。
 */
export function isApiBody<P extends keyof paths>(path: P, value: unknown): value is ApiBody<P, 'post'> {
  return validateInput('body', path, value)
}

/**
 * 校验查询筛选条件并收窄为指定接口的查询类型。
 * @param path OpenAPI 路径模板。
 * @param value 文件或选项提供的未知值。
 * @returns 是否符合查询参数结构；仅对有查询参数的读取路由有效。
 */
export function isApiQuery<P extends keyof paths>(path: P, value: unknown): value is ApiQuery<P, 'get'> {
  return validateInput('query', path, value)
}
