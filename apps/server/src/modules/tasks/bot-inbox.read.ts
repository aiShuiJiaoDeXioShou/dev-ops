import { and, desc, eq, sql } from 'drizzle-orm'
import { Type } from 'typebox'
import type { Database } from '../../platform/database/client.ts'
import { apiResponseSchema } from '../../platform/http/response.ts'
import { botConversation } from '../collaboration/bot-conversations.tables.ts'
import { membershipQuery } from '../collaboration/bot-conversations.access.ts'
import { conversationWorkStatus } from '../collaboration/bot-conversation-status.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'

export const botInboxResponse = apiResponseSchema(
  Type.Object({
    count: Type.Integer({ minimum: 0 }),
    items: Type.Array(
      Type.Object({
        id: Type.String(),
        conversationId: Type.String(),
        conversationName: Type.String(),
        updatedAt: Type.String(),
        reason: Type.Literal('awaiting_reply'),
      }),
    ),
  }),
)

/**
 * 汇总当前成员可见且等待回复的会话。
 * @param db 数据库。
 * @param actor 当前成员。
 * @param teamId 当前团队。
 * @returns 最近 50 条会话及总数，排除已移出或失效的成员关系。
 */
export async function readBotInbox(db: Database, actor: SessionUser, teamId: string) {
  await requireTeamMember(db, actor.id, teamId)
  const visible = membershipQuery(db, actor)
    .where(and(eq(botConversation.team_id, teamId), sql`${conversationWorkStatus()} = 'awaiting_reply'`))
    .as('visible')
  const rows = await db
    .select({
      row: { id: visible.row.id, name: visible.row.name, last_message_at: visible.row.last_message_at },
      total: sql`count(*) over ()`.mapWith(Number),
    })
    .from(visible)
    .orderBy(desc(visible.row.last_message_at), desc(visible.row.id))
    .limit(50)
  return {
    count: rows[0]?.total ?? 0,
    items: rows.map(({ row }) => ({
      id: row.id,
      conversationId: row.id,
      conversationName: row.name,
      updatedAt: row.last_message_at.toISOString(),
      reason: 'awaiting_reply' as const,
    })),
  }
}
