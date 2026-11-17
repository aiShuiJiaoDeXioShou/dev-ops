import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { Type } from 'typebox'
import type { Database } from '../../platform/database/client.ts'
import { apiResponseSchema } from '../../platform/http/response.ts'
import { botConversation, botConversationMember } from '../collaboration/bot-conversations.tables.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { botTask } from './bot-tasks.tables.ts'

export const botInboxResponse = apiResponseSchema(
  Type.Object({
    count: Type.Integer({ minimum: 0 }),
    items: Type.Array(
      Type.Object({
        id: Type.String(),
        conversationId: Type.String(),
        conversationName: Type.String(),
        taskTitle: Type.String(),
        updatedAt: Type.String(),
        reason: Type.Union([Type.Literal('awaiting_review'), Type.Literal('blocked')]),
      }),
    ),
  }),
)

/**
 * 派生当前团队可见的待验收或受阻任务。
 * @param db 平台数据库。
 * @param actor 当前团队成员。
 * @param teamId 团队标识。
 * @returns 去重的最近 50 条待处理项和全部可见数量，不额外创建状态记录。
 */
export async function readBotInbox(db: Database, actor: SessionUser, teamId: string) {
  await requireTeamMember(db, actor.id, teamId)
  const rows = await db
    .select({
      id: botTask.id,
      conversationId: botTask.conversation_id,
      conversationName: botConversation.name,
      taskTitle: botTask.title,
      updatedAt: botTask.updated_at,
      status: botTask.status,
      total: sql`count(*) over ()`.mapWith(Number),
    })
    .from(botTask)
    .innerJoin(
      botConversation,
      and(eq(botConversation.id, botTask.conversation_id), eq(botConversation.team_id, botTask.team_id)),
    )
    .innerJoin(
      botConversationMember,
      and(
        eq(botConversationMember.team_id, botTask.team_id),
        eq(botConversationMember.conversation_id, botTask.conversation_id),
        eq(botConversationMember.member_id, actor.id),
        eq(botConversationMember.member_kind, 'user'),
        isNull(botConversationMember.removed_at),
      ),
    )
    .where(and(eq(botTask.team_id, teamId), or(eq(botTask.status, 'awaiting_review'), eq(botTask.blocked, true))))
    .orderBy(desc(botTask.updated_at), desc(botTask.id))
    .limit(50)
  return {
    count: rows[0]?.total ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      conversationName: row.conversationName,
      taskTitle: row.taskTitle,
      updatedAt: row.updatedAt.toISOString(),
      reason: row.status === 'awaiting_review' ? ('awaiting_review' as const) : ('blocked' as const),
    })),
  }
}
