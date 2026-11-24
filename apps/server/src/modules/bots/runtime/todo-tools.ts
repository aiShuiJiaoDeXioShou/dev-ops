import type { BotTool } from '@dev-ops/devops-bot'
import { and, eq, gt, sql } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { botConversation } from '../../collaboration/bot-conversations.tables.ts'
import { conversationTodos } from '../../collaboration/bot-todos.ts'
import { requireBotConversation } from '../../collaboration/bot-conversations.access.ts'
import type { BotRunLease, ConversationBotRunRecord } from '../bots.run-queue.repository.ts'
import { botRun } from '../bots.tables.ts'
import { hasChatCredential } from './content.ts'

const inputSchema = Type.Object({ items: conversationTodos, needsReply: Type.Optional(Type.Boolean()) })

/**
 * 创建本次工作待办工具，替换会话清单并持久化供成员查看。
 * @param db 平台数据库。
 * @param run 当前会话运行。
 * @param lease 当前租约；过期或已停止时拒绝写入。
 * @returns 模型工具；数据库失败向运行层传播。
 */
export function createTodoTool(db: Database, run: ConversationBotRunRecord, lease: BotRunLease): BotTool {
  return {
    name: 'update_todos',
    description:
      '写入或更新本次工作的完整待办清单。开始工作时列出步骤，执行中更新状态，完成后勾选 completed；不要写入凭据。需要成员回答时设置 needsReply 为 true，并在回复中明确提出问题。',
    parameters: inputSchema,
    /** 校验完整清单并按会话、触发人和运行租约保存；失败不覆盖旧清单。 */
    async execute(input, signal) {
      signal.throwIfAborted()
      if (!Check(inputSchema, input)) return { text: '待办格式不合法', isError: true }
      if (input.items.some(({ text }) => hasChatCredential(text))) return { text: '待办不能包含凭据', isError: true }
      return db.transaction(async (tx) => {
        await tx
          .select({ id: botConversation.id })
          .from(botConversation)
          .where(eq(botConversation.id, run.conversation_id))
          .for('update')
        await requireBotConversation(tx, { id: run.trigger_user_id }, run.conversation_id, true)
        const [active] = await tx
          .select({ id: botRun.id })
          .from(botRun)
          .where(
            and(
              eq(botRun.id, lease.id),
              eq(botRun.lease_owner, lease.owner),
              eq(botRun.lease_epoch, lease.epoch),
              eq(botRun.status, 'running'),
              eq(botRun.stop_requested, false),
              gt(botRun.lease_until, sql`clock_timestamp()`),
            ),
          )
          .for('update')
        if (!active) return { text: '运行已停止或租约失效', isError: true }
        signal.throwIfAborted()
        await tx
          .update(botConversation)
          .set({
            todos: input.items,
            reply_requested_run_id: input.needsReply ? run.id : null,
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(botConversation.id, run.conversation_id), eq(botConversation.team_id, run.team_id)))
        return { text: '待办清单已更新' }
      })
    },
  }
}
