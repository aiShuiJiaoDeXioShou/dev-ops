import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { IncomingHttpHeaders } from 'node:http'
import type { Database } from '../database/client.ts'
import { idempotencyRecord } from '../database/idempotency.tables.ts'
import { ERROR_CODES } from './error-codes.ts'
import { ApiError } from './errors.ts'
import { requestHash } from './idempotency.ts'

const NIL_TEAM_ID = '00000000-0000-0000-0000-000000000000'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_KEY_LENGTH = 128
const AUTH_PREFIX = '/api/v1/auth/'

interface IdempotencyHookOptions {
  db: Database
  getUserId: (headers: IncomingHttpHeaders) => Promise<string | null>
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueConstraintError(error.cause)
}

/**
 * 计算幂等作用域与团队标识。
 * 使用实际请求路径而非路由模式：同一用户在不同团队/项目复用同一个 Idempotency-Key 时，
 * 实际资源路径不同，不应被误判为重复请求；路径中的动态标识均为服务端校验过的 UUID。
 * @param input 请求 URL 与已解析的路由参数。
 * @returns 不含查询串的作用域与团队标识；无法从参数确定团队时使用 nil UUID。
 */
export function idempotencyScopeFor(input: { url: string; params: unknown }): { scope: string; teamId: string } {
  const scope = input.url.split('?')[0] ?? input.url
  const params = input.params
  const teamId =
    typeof params === 'object' &&
    params !== null &&
    'teamId' in params &&
    typeof params.teamId === 'string' &&
    UUID_PATTERN.test(params.teamId)
      ? params.teamId
      : NIL_TEAM_ID
  return { scope, teamId }
}

function payloadIsFailure(payload: unknown): boolean {
  if (typeof payload !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(payload)
    return typeof parsed === 'object' && parsed !== null && 'success' in parsed && parsed.success === false
  } catch {
    return false
  }
}

/**
 * 创建通用 POST 幂等钩子：带 `Idempotency-Key` 的已登录业务请求先登记，
 * 成功保留、失败清理；重复键返回 IDEMPOTENCY_CONFLICT，不重复执行业务写入。
 * @param options 数据库连接与当前请求用户读取函数。
 * @returns Fastify preHandler 与 onSend 钩子。
 * @remarks 认证协议端点与未登录请求跳过；团队作用域未知时用 nil UUID，scope 已包含路由模式。
 */
export function createIdempotencyHooks(options: IdempotencyHookOptions) {
  const records = new WeakMap<FastifyRequest, string>()

  async function preHandler(request: FastifyRequest) {
    if (request.method !== 'POST' || request.url.startsWith(AUTH_PREFIX)) return
    // 原始流上传路由显式关闭：流式请求体无法稳定哈希，冲突时也不会 drain 请求体。
    if (request.routeOptions.config?.idempotency === false) return
    const header = request.headers['idempotency-key']
    const key = Array.isArray(header) ? header[0] : header
    if (!key) return
    if (key.length > MAX_KEY_LENGTH || key.trim().length === 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Idempotency-Key 长度必须在 1-128 个字符之间')
    }
    const userId = await options.getUserId(request.headers)
    if (!userId) return
    const { scope, teamId } = idempotencyScopeFor({ url: request.url, params: request.params })
    const recordId = randomUUID()
    try {
      await options.db.insert(idempotencyRecord).values({
        id: recordId,
        team_id: teamId,
        actor_user_id: userId,
        scope,
        idempotency_key: key,
        request_hash: requestHash({ scope, body: request.body }),
        response_entity_type: 'http_response',
        response_entity_id: null,
        status_code: 200,
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ApiError(ERROR_CODES.IDEMPOTENCY_CONFLICT, '请求已处理，请刷新后查看结果')
      }
      throw error
    }
    records.set(request, recordId)
  }

  async function onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
    const recordId = records.get(request)
    if (!recordId) return payload
    records.delete(request)
    if (reply.statusCode < 400 && !payloadIsFailure(payload)) return payload
    try {
      await options.db.delete(idempotencyRecord).where(eq(idempotencyRecord.id, recordId))
    } catch {
      // 清理为尽力而为，不覆盖原始业务响应；过期记录由后续清理任务处理。
    }
    return payload
  }

  return { preHandler, onSend }
}
