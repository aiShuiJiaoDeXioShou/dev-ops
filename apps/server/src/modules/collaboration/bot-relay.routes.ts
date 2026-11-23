import { and, eq } from 'drizzle-orm'
import { Type } from 'typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { success } from '../../platform/http/response.ts'
import { enqueueBotRun, requestBotRunStop } from '../bots/bots.run-queue.repository.ts'
import { requireHumanActor } from '../identity/identity.actor.ts'
import { botRun } from '../bots/bots.tables.ts'
import { botRelayResponse } from './bot-conversations.schema.ts'
import { lockWritableBotConversation } from './bot-conversations.access.ts'
import {
  advanceBotRelay,
  botRelayView,
  latestBotRelayRun,
  updateBotRelay,
  type BotRelayLimits,
} from './bot-relay.repository.ts'
import { botRoomRelay } from './bot-relay.tables.ts'

function stateConflict(): never {
  throw new ApiError(ERROR_CODES.BOT_RELAY_STATE_CONFLICT, '接力状态已变化，请刷新后重试')
}

/**
 * 注册群聊接力的成员控制操作。旧版本请求不得覆盖接力进度。
 * @param app HTTP 应用。
 * @param options 平台数据库和公开接力限额。
 * @returns 注册完成，匿名、浏览者和 Bot 委托均无写权限。
 */
export const botRelayRoutes: FastifyPluginAsyncTypebox<{ db: Database; limits: BotRelayLimits }> = async (
  app,
  { db, limits },
) => {
  const params = Type.Object({
    relayId: Type.String({ pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }),
  })
  const body = Type.Object({ version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
  for (const action of ['continue', 'end', 'stop'] as const) {
    const label = { continue: '继续暂停的群聊接力', end: '结束群聊接力', stop: '停止群聊接力与当前运行' }[action]
    app.post(
      `/bot-relays/:relayId/${action}`,
      {
        schema: { summary: label, params, body, response: { 200: botRelayResponse } },
      },
      async (request) => {
        const actor = await requireHumanActor(request)
        const relay = await db.transaction(async (tx) => {
          const [scope] = await tx
            .select({ roomId: botRoomRelay.conversation_id, teamId: botRoomRelay.team_id })
            .from(botRoomRelay)
            .where(eq(botRoomRelay.id, request.params.relayId))
          if (!scope) throw new ApiError(ERROR_CODES.NOT_FOUND, '接力不存在或不可见')
          const room = await lockWritableBotConversation(tx, actor, scope.roomId)
          if (room.team_id !== scope.teamId) throw new ApiError(ERROR_CODES.NOT_FOUND, '接力不存在或不可见')
          const [previous] = await tx.select().from(botRoomRelay).where(eq(botRoomRelay.id, request.params.relayId))
          if (!previous || previous.version !== request.body.version) return stateConflict()
          const latest = await latestBotRelayRun(tx, previous)
          if (latest) await tx.select({ id: botRun.id }).from(botRun).where(eq(botRun.id, latest.id)).for('update')
          const [row] = await tx
            .select()
            .from(botRoomRelay)
            .where(and(eq(botRoomRelay.id, request.params.relayId), eq(botRoomRelay.team_id, room.team_id)))
            .for('update')
          if (!row || row.version !== request.body.version || (row.status !== 'running' && row.status !== 'paused'))
            return stateConflict()
          const current = await latestBotRelayRun(tx, row)
          if (action === 'continue') {
            if (row.status !== 'paused') return stateConflict()
            const restarted = await updateBotRelay(tx, row, {
              status: 'running',
              reply_count: 0,
              hop_count: 0,
              trigger_user_id: actor.id,
              continue_count: row.continue_count + 1,
            })
            return advanceBotRelay(tx, restarted, limits, enqueueBotRun)
          }
          const saved = await updateBotRelay(
            tx,
            row,
            {
              status: action === 'stop' ? 'stopped' : 'finished',
              end_reason: action === 'stop' ? 'stopped_by_member' : 'ended_by_member',
              pending_bot_ids: [],
            },
            current?.id,
          )
          if (current && (action === 'stop' || current.status === 'queued')) {
            await requestBotRunStop(tx, current.id, actor.id)
          }
          return saved
        })
        return success(botRelayView(relay, limits), request.id)
      },
    )
  }
}
