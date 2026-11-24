import type { QueuedInputSource } from '@dev-ops/devops-bot'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { botMessage } from '../../collaboration/bot-conversations.tables.ts'
import { describeMessageAttachments } from './conversation-attachment-tool.ts'
import { botMessageBodySchema } from '../../collaboration/bot-message-body.ts'
import { authUser } from '../../identity/identity.tables.ts'
import { lockBotRunLease, type BotRunLease, type ConversationBotRunRecord } from '../bots.run-queue.repository.ts'
import { botRunInput } from '../bots.session.tables.ts'

/**
 * 向 Pi 提供当前运行的追加和插话队列。交付由会话条目写回事务确认。
 * @param db 执行进程数据库。
 * @param run 当前会话运行。
 * @param lease 读取队列时校验的租约。
 * @returns 运行库读取尚未确认输入的端口。
 */
export function createPgRunInputQueue(
  db: Database,
  run: ConversationBotRunRecord,
  lease: BotRunLease,
): QueuedInputSource {
  return {
    async take({ allowFollowUp }) {
      return db.transaction(async (tx) => {
        const active = await lockBotRunLease(tx, lease)
        if (!active || active.stop_requested) return []
        const rows = await tx
          .select({
            messageId: botRunInput.message_id,
            mode: botRunInput.delivery_mode,
            body: botMessage.body,
            name: authUser.name,
          })
          .from(botRunInput)
          .innerJoin(
            botMessage,
            and(
              eq(botMessage.id, botRunInput.message_id),
              eq(botMessage.team_id, run.team_id),
              eq(botMessage.conversation_id, run.conversation_id),
              eq(botMessage.speaker_id, run.trigger_user_id),
            ),
          )
          .innerJoin(authUser, eq(authUser.id, run.trigger_user_id))
          .where(
            and(
              eq(botRunInput.team_id, run.team_id),
              eq(botRunInput.run_id, lease.id),
              inArray(botRunInput.status, ['pending', 'delivering']),
            ),
          )
          .orderBy(sql`case when ${botRunInput.delivery_mode} = 'steer' then 0 else 1 end`, asc(botMessage.sequence))
          .limit(25)
        const mode = rows.some((row) => row.mode === 'steer') ? 'steer' : allowFollowUp ? 'follow_up' : null
        const selected = rows.filter((row) => row.mode === mode).slice(0, 1)
        if (selected.length === 0) return []
        await tx
          .update(botRunInput)
          .set({ status: 'delivering', updated_at: sql`clock_timestamp()` })
          .where(
            and(
              eq(botRunInput.run_id, lease.id),
              eq(botRunInput.team_id, run.team_id),
              inArray(
                botRunInput.message_id,
                selected.map((row) => row.messageId),
              ),
              inArray(botRunInput.status, ['pending', 'delivering']),
            ),
          )
        return selected.map(({ messageId, mode, body, name }) => {
          if ((mode !== 'steer' && mode !== 'follow_up') || !Check(botMessageBodySchema, body)) {
            throw new Error('数据库中的待投递会话消息不合法')
          }
          return {
            messageId,
            mode,
            text: `${name}：${body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')}${describeMessageAttachments(messageId, body.attachments)}`,
          }
        })
      })
    },
  }
}

/**
 * 在持久化 Pi 用户条目的同一事务中确认已实际使用的排队输入。
 * @param tx 已校验租约的会话写回事务。
 * @param run 当前会话运行。
 * @param messageIds 本批条目所关联的房间消息。
 * @returns 数据变更完成后结束；无消息时无需查询。
 */
export async function acknowledgeBotRunInputs(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  run: ConversationBotRunRecord,
  messageIds: string[],
): Promise<void> {
  if (messageIds.length === 0) return
  await tx
    .update(botRunInput)
    .set({ status: 'delivered', updated_at: sql`clock_timestamp()` })
    .where(
      and(
        eq(botRunInput.team_id, run.team_id),
        eq(botRunInput.run_id, run.id),
        inArray(botRunInput.status, ['pending', 'delivering']),
        inArray(botRunInput.message_id, messageIds),
      ),
    )
}
