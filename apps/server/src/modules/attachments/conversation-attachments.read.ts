import { and, eq } from 'drizzle-orm'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { botMessage } from '../collaboration/bot-conversations.tables.ts'
import { botMessageBodySchema } from '../collaboration/bot-message-body.ts'
import { findAttachmentById } from './attachments.repository.ts'

/**
 * 读取指定会话消息所引用的已绑定附件，调用方先校验会话成员关系。
 * @param db 数据库或当前事务。
 * @param input 团队、会话、消息和附件标识。
 * @returns 同团队的附件记录，无对应关系时为空。分叉和编辑重发可以引用原附件。
 */
export async function findConversationMessageAttachment(
  db: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
  input: { teamId: string; conversationId: string; messageId: string; attachmentId: string },
) {
  const [message] = await db
    .select({ body: botMessage.body })
    .from(botMessage)
    .where(
      and(
        eq(botMessage.id, input.messageId),
        eq(botMessage.team_id, input.teamId),
        eq(botMessage.conversation_id, input.conversationId),
      ),
    )
  if (!message) return undefined
  if (!Check(botMessageBodySchema, message.body)) throw new Error('数据库中的会话消息格式不合法')
  if (!message.body.attachments?.some(({ id }) => id === input.attachmentId)) return undefined
  const row = await findAttachmentById(db, input.attachmentId)
  if (row?.status !== 'bound' || row.target_type !== 'bot_message' || row.team_id !== input.teamId || row.purged_at)
    return undefined
  return row
}
