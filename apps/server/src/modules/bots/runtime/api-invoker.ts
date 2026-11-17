import type {
  ApiInvocation,
  ApiInvocationResult,
  ApiInvoker,
  JsonValue,
  PlatformApiOperation,
} from '@dev-ops/devops-bot'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Database } from '../../../platform/database/client.ts'
import { appendBotEvents } from '../../collaboration/bot-events.repository.ts'
import { botConversationMember } from '../../collaboration/bot-conversations.tables.ts'
import { withBotActor, type BotActor, type BotDelegation } from '../../identity/identity.bot-delegation.ts'
import { authUser, teamMember } from '../../identity/identity.tables.ts'
import { botApiExclusion } from '../bots.api-denylist.ts'
import { lockBotRunLease, type BotRunLease } from '../bots.run-queue.repository.ts'
import { botApiCall } from '../bots.tables.ts'
import { isBotApiInTeam } from './api-scope.ts'
import { hasChatCredential, redactChatContent } from './content.ts'

const TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 120_000
const MAX_REQUEST_BYTES = 64_000
const API_PREFIX = '/api/v1/'
const RESULT_UNKNOWN = 'BOT_API_RESULT_UNKNOWN'
const DENIED = 'BOT_API_FORBIDDEN'

export type BotCallLog = {
  runId: string
  teamId: string
  conversationId: string
  botId: string
  callId: string
  kind: 'platform_api' | 'web_fetch' | 'web_search'
  status: 'succeeded' | 'rejected' | 'failed' | 'unknown'
  code: string
}

type InvokerOptions = {
  db: Database
  app: Pick<FastifyInstance, 'inject'>
  delegation: BotDelegation
  catalog: readonly PlatformApiOperation[]
  lease: BotRunLease
  teamId: string
  conversationId: string
  botId: string
  logCall?: (event: BotCallLog) => void
}

function isObject(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function normalizePath(path: string) {
  if (!path.startsWith(API_PREFIX) || path.length > 1000 || /[?#]/u.test(path)) return null
  try {
    const pieces = path.slice(1).split('/').map(decodeURIComponent)
    if (
      pieces.some(
        (piece) =>
          !piece ||
          piece === '.' ||
          piece === '..' ||
          piece.includes('/') ||
          piece.includes('\\') ||
          [...piece].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
      )
    )
      return null
    return `/${pieces.map(encodeURIComponent).join('/')}`
  } catch {
    return null
  }
}

function matchesTemplate(template: string, path: string) {
  const expected = template.split('/')
  const actual = path.split('/')
  return expected.length === actual.length && expected.every((part, i) => part.startsWith('{') || part === actual[i])
}

function queryString(query: ApiInvocation['query']) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values)
      if (item !== null) params.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item))
  }
  return params.size ? `?${params}` : ''
}

function stringRef(data: unknown) {
  if (!isObject(data) || typeof data.id !== 'string' || data.id.length > 80 || hasChatCredential(data.id)) return null
  return { id: data.id }
}

function redactJson(value: unknown, depth = 10): JsonValue {
  if (typeof value === 'string') return redactChatContent(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (depth === 0) return null
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactJson(item, depth - 1))
  if (!isObject(value)) return null
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 200)
      .flatMap(([key, entry]) => {
        if (
          /(?:password|secret|ciphertext|access_token|refresh_token|api_key|authorization|cookie|credentialValue)/iu.test(
            key,
          )
        )
          return []
        return [[key, redactJson(entry, depth - 1)]]
      }),
  )
}

async function acquireActor(options: InvokerOptions): Promise<BotActor | null> {
  const { db, lease, teamId, conversationId, botId } = options
  return db.transaction(async (tx) => {
    const run = await lockBotRunLease(tx, lease)
    if (
      !run ||
      run.stop_requested ||
      run.team_id !== teamId ||
      run.conversation_id !== conversationId ||
      run.bot_id !== botId
    )
      return null
    const [user] = await tx
      .select({ id: authUser.id, email: authUser.email, name: authUser.name })
      .from(authUser)
      .innerJoin(
        teamMember,
        and(eq(teamMember.user_id, authUser.id), eq(teamMember.team_id, teamId), eq(teamMember.status, 'active')),
      )
      .innerJoin(
        botConversationMember,
        and(
          eq(botConversationMember.team_id, teamId),
          eq(botConversationMember.conversation_id, conversationId),
          eq(botConversationMember.member_kind, 'user'),
          eq(botConversationMember.member_id, authUser.id),
          isNull(botConversationMember.removed_at),
        ),
      )
      .where(eq(authUser.id, run.trigger_user_id))
    if (!user) return null
    return { user, credential: 'bot', teamId, viaBotId: botId, runId: run.id, leaseEpoch: lease.epoch }
  })
}

function timed<Result>(work: Promise<Result>, signal: AbortSignal): Promise<Result> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * 组装执行进程内的平台 API 端口，所有调用使用触发人的通行权限并留下脱敏轨迹。
 * @param options 当前运行租约、内部 Fastify 实例及过滤后的路由目录。
 * @returns 一次性委托转发端口。写操作先保留幂等名额，结果未知时不会再次发起请求。
 */
export function createBotApiInvoker(options: InvokerOptions): ApiInvoker {
  const { db, app, delegation, catalog, lease, teamId, conversationId } = options
  const scope = { teamId, conversationId, runId: lease.id }
  return {
    /** 校验路径、租约与所属团队后转发，记录状态和可公开的资源引用。 */
    async invoke(input, signal) {
      signal?.throwIfAborted()
      const path = normalizePath(input.path)
      const operation = path && catalog.find((item) => item.method === input.method && matchesTemplate(item.path, path))
      const key = input.method === 'POST' ? input.idempotencyKey : null
      if (input.method === 'POST' && (!key || !/^[a-zA-Z0-9_-]{1,87}$/u.test(key))) {
        return { ok: false, code: 'VALIDATION_ERROR' }
      }

      const actor = await acquireActor(options)
      if (!actor) return { ok: false, code: DENIED }
      const reserved = await db
        .insert(botApiCall)
        .values({
          team_id: teamId,
          run_id: lease.id,
          kind: 'platform_api',
          method: input.method,
          target: operation ? operation.path : '平台路由',
          idempotency_key: key,
          input_summary: operation ? operation.summary.slice(0, 200) : '接口不在可用目录',
          status: 'unknown',
        })
        .onConflictDoNothing({ target: [botApiCall.run_id, botApiCall.idempotency_key] })
        .returning({ id: botApiCall.id })
      const callId = reserved[0]?.id
      if (!callId) {
        const [previous] = await db
          .select({
            status: botApiCall.status,
            code: botApiCall.result_code,
            ref: botApiCall.result_ref,
          })
          .from(botApiCall)
          .where(
            and(
              eq(botApiCall.team_id, teamId),
              eq(botApiCall.run_id, lease.id),
              key === null ? isNull(botApiCall.idempotency_key) : eq(botApiCall.idempotency_key, key),
            ),
          )
        return previous
          ? {
              ok: previous.status === 'succeeded',
              code: previous.code ?? RESULT_UNKNOWN,
              data: redactJson(previous.ref),
            }
          : { ok: false, code: RESULT_UNKNOWN }
      }
      const savedCallId = callId
      async function finish(result: ApiInvocationResult, status: 'succeeded' | 'rejected' | 'failed' | 'unknown') {
        await db.transaction(async (tx) => {
          await tx
            .update(botApiCall)
            .set({
              status,
              result_code: result.code,
              result_ref: stringRef(result.data),
              updated_at: new Date(),
            })
            .where(and(eq(botApiCall.team_id, teamId), eq(botApiCall.run_id, lease.id), eq(botApiCall.id, savedCallId)))
          await appendBotEvents(tx, scope, [
            {
              kind: 'tool_activity',
              payload: {
                state: status,
                name: 'platform_api_call',
                callId,
                method: input.method,
                path: operation ? operation.path : null,
                code: result.code,
              },
            },
          ])
        })
        options.logCall?.({
          ...scope,
          botId: options.botId,
          callId: savedCallId,
          kind: 'platform_api',
          status,
          code: result.code,
        })
        return result
      }
      if (
        !path ||
        !operation ||
        botApiExclusion(input.method, path) ||
        !(await isBotApiInTeam(db, teamId, operation.path, path))
      ) {
        return finish({ ok: false, code: DENIED }, 'rejected')
      }
      const query = queryString(input.query)
      const body = input.method === 'POST' ? input.body : undefined
      if (
        Buffer.byteLength(query) + Buffer.byteLength(JSON.stringify(body) ?? '') > MAX_REQUEST_BYTES ||
        (isObject(body) && 'teamId' in body && body.teamId !== teamId) ||
        ('teamId' in (input.query ?? {}) && input.query?.teamId !== teamId)
      ) {
        return finish({ ok: false, code: 'VALIDATION_ERROR' }, 'rejected')
      }
      const deadline = AbortSignal.timeout(TIMEOUT_MS)
      const cancellation = signal ? AbortSignal.any([deadline, signal]) : deadline
      let response
      try {
        cancellation.throwIfAborted()
        response = await timed(
          delegation.withToken(actor, (token) =>
            withBotActor(actor, async () => {
              const headers: Record<string, string> = { authorization: `Bearer ${token}` }
              if (key) headers['idempotency-key'] = `bot:${lease.id}:${key}`
              return app.inject({
                url: path + query,
                method: input.method,
                headers,
                ...(body === undefined
                  ? {}
                  : { payload: JSON.stringify(body), headers: { ...headers, 'content-type': 'application/json' } }),
              })
            }),
          ),
          cancellation,
        )
      } catch {
        return finish({ ok: false, code: RESULT_UNKNOWN }, 'unknown')
      }
      if (
        response.statusCode !== 200 ||
        !response.headers['content-type']?.includes('application/json') ||
        Buffer.byteLength(response.body) > MAX_RESPONSE_BYTES
      ) {
        return finish({ ok: false, code: 'BOT_API_RESPONSE_UNAVAILABLE' }, 'failed')
      }
      let envelope: unknown
      try {
        envelope = response.json()
      } catch {
        return finish({ ok: false, code: 'BOT_API_RESPONSE_UNAVAILABLE' }, 'failed')
      }
      if (!isObject(envelope) || typeof envelope.success !== 'boolean' || typeof envelope.code !== 'string') {
        return finish({ ok: false, code: 'BOT_API_RESPONSE_UNAVAILABLE' }, 'failed')
      }
      const data = input.method === 'POST' ? stringRef(envelope.data) : redactJson(envelope.data)
      const result = { ok: envelope.success, code: envelope.code, data }
      return finish(result, envelope.success ? 'succeeded' : 'failed')
    },
  }
}
