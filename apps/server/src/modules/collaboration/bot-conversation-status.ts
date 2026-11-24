import { sql } from 'drizzle-orm'
import { botRun } from '../bots/bots.tables.ts'
import { botConversation } from './bot-conversations.tables.ts'
import { botRoomRelay } from './bot-relay.tables.ts'

/** 以最新运行和接力状态派生会话状态；同一表达式用于列表与待回复汇总。 */
export function conversationWorkStatus() {
  return sql<string | null>`case
    when not exists (select 1 from ${botRun} where ${botRun.conversation_id} = ${botConversation.id}) then null
    when exists (select 1 from ${botRun} where ${botRun.conversation_id} = ${botConversation.id} and ${botRun.status} in ('queued', 'running')) then 'running'
    when exists (select 1 from ${botRoomRelay} where ${botRoomRelay.conversation_id} = ${botConversation.id} and ${botRoomRelay.status} = 'paused') then 'awaiting_reply'
    when (select ${botRun.status} in ('failed', 'stopped') or ${botRun.id} = ${botConversation.reply_requested_run_id} from ${botRun} where ${botRun.conversation_id} = ${botConversation.id} order by ${botRun.created_at} desc, ${botRun.id} desc limit 1) then 'awaiting_reply'
    else 'completed' end`
}

/** 收窄数据库派生状态，异常值不得冒充已完成。 */
export function readConversationWorkStatus(value: unknown): 'running' | 'awaiting_reply' | 'completed' | null {
  if (value === null) return null
  if (value === 'running' || value === 'awaiting_reply' || value === 'completed') return value
  throw new Error('数据库会话运行状态不合法')
}
