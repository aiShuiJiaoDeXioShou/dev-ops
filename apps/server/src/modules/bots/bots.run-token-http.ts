import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { authenticateBotRunToken } from './bots.run-tokens.ts'
import { botApiExclusion } from './bots.api-denylist.ts'
import { withBotActor, type BotActor } from '../identity/identity.bot-delegation.ts'
import { botRun, botApiCall } from './bots.tables.ts'
import { appendBotEvents } from '../collaboration/bot-events.repository.ts'

/**
 * 为所有 HTTP 路由校验运行令牌，并记录脱敏调用结果和耗时。
 * @param app 已装饰数据库的 HTTP 实例，须在业务路由前注册。
 * @returns 注册认证与响应审计钩子，无返回值。
 * @throws 请求认证或审计数据库失败通过 HTTP 错误处理器返回失败。
 */
export function registerBotRunTokenHttp(app: FastifyInstance): void {
  const requests = new WeakMap<FastifyRequest, { actor: BotActor; start: number }>()
  app.addHook('onRequest', (request, _reply, done) => {
    const token = request.headers.authorization?.match(/^Bearer\s+(devops-run-\S+)$/iu)?.[1]
    if (!token) return done()
    void authenticateBotRunToken(app.db, token).then((actor) => {
      if (!actor) return done(new ApiError(ERROR_CODES.UNAUTHENTICATED, '运行凭据已失效'))
      requests.set(request, { actor, start: performance.now() })
      const path = request.routeOptions.url ?? request.url.split('?')[0] ?? ''
      if ((request.method !== 'GET' && request.method !== 'POST') || botApiExclusion(request.method, path)) {
        return done(new ApiError(ERROR_CODES.BOT_API_FORBIDDEN, 'Bot 不可调用此接口'))
      }
      withBotActor(actor, () => done())
    }, done)
  })
  app.addHook('onSend', async (request, _reply, payload) => {
    const state = requests.get(request)
    if (!state) return payload
    let code = 'OK'
    if (typeof payload === 'string') {
      try {
        const value: unknown = JSON.parse(payload)
        if (value && typeof value === 'object' && 'code' in value && typeof value.code === 'string') code = value.code
      } catch {
        code = 'BOT_API_RESPONSE_UNAVAILABLE'
      }
    }
    const path = request.routeOptions.url ?? '/unknown'
    const elapsedMs = Math.round(performance.now() - state.start)
    const status = code === 'OK' ? 'succeeded' : 'failed'
    await app.db.transaction(async (tx) => {
      const [call] = await tx
        .insert(botApiCall)
        .values({
          team_id: state.actor.teamId,
          run_id: state.actor.runId,
          kind: 'platform_api',
          method: request.method === 'GET' ? 'GET' : 'POST',
          target: path,
          input_summary: `${request.method} ${path}`,
          status,
          result_code: code,
          result_ref: { elapsedMs },
        })
        .returning({ id: botApiCall.id })
      const [run] = await tx
        .select({ conversationId: botRun.conversation_id })
        .from(botRun)
        .where(eq(botRun.id, state.actor.runId))
      if (run?.conversationId && call)
        await appendBotEvents(
          tx,
          { teamId: state.actor.teamId, runId: state.actor.runId, conversationId: run.conversationId },
          [
            {
              kind: 'tool_activity',
              payload: {
                state: status,
                name: 'devops',
                callId: call.id,
                method: request.method,
                path,
                code,
                elapsedMs,
              },
            },
          ],
        )
    })
    return payload
  })
}
