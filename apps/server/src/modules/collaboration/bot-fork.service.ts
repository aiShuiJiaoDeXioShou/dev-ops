import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import type { BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import { cloneBotSessionPrefixes } from '../bots/runtime/clone-session.ts'
import { activeBotBranchScope } from './bot-branches.repository.ts'
import { botConversation, botConversationMember, botMessage, workTagLink } from './bot-conversations.tables.ts'
import { readTargetWorkTags } from './work-tags.repository.ts'

/**
 * 从已授权的会话消息切出一份独立的会话和 Bot 上下文。
 * @param tx 锁住原会话的写事务。
 * @param room 原始会话数据，需由调用方校验成员与角色。
 * @param actorId 发起分叉的成员。
 * @param input 分叉消息及可选的新会话名称。
 * @returns 新会话记录；分叉位置不在当前分支时拒绝。
 */
export async function forkBotConversation(
  tx: BotRunTransaction,
  room: typeof botConversation.$inferSelect,
  actorId: string,
  input: { messageId: string; name?: string },
) {
  const scope = await activeBotBranchScope(tx, room)
  const [source] = await tx
    .select({ sequence: botMessage.sequence, createdAt: botMessage.created_at })
    .from(botMessage)
    .where(and(scope, eq(botMessage.id, input.messageId)))
  if (!source) throw new ApiError(ERROR_CODES.NOT_FOUND, '分叉消息不在当前会话分支')
  const [forked] = await tx
    .insert(botConversation)
    .values({
      team_id: room.team_id,
      kind: room.kind,
      name: input.name?.trim() || `${room.name.slice(0, 75)} 分叉`,
      leader_bot_id: room.leader_bot_id,
      responsibility: room.responsibility,
      instructions: room.instructions,
      created_by: actorId,
      last_message_at: source.createdAt,
      forked_from_conversation_id: room.id,
      forked_from_message_id: input.messageId,
    })
    .returning()
  if (!forked) throw new Error('未能创建分叉会话')
  const members = await tx
    .select({ kind: botConversationMember.member_kind, id: botConversationMember.member_id })
    .from(botConversationMember)
    .where(
      and(
        eq(botConversationMember.team_id, room.team_id),
        eq(botConversationMember.conversation_id, room.id),
        isNull(botConversationMember.removed_at),
      ),
    )
    .orderBy(asc(botConversationMember.created_at), asc(botConversationMember.id))
  if (members.length) {
    await tx.insert(botConversationMember).values(
      members.map(({ kind, id }, index) => ({
        team_id: room.team_id,
        conversation_id: forked.id,
        member_kind: kind,
        member_id: id,
        added_by: actorId,
        created_at: new Date(forked.created_at.getTime() + index),
      })),
    )
  }
  const tags = await readTargetWorkTags(tx, room.team_id, { targetKind: 'conversation', targetId: room.id })
  if (tags.length) {
    await tx.insert(workTagLink).values(
      tags.map(({ id }) => ({
        team_id: room.team_id,
        tag_id: id,
        target_kind: 'conversation',
        target_id: forked.id,
        linked_by_kind: 'user',
        linked_by_id: actorId,
      })),
    )
  }
  const messages = new Map<string, { id: string; sequence: bigint }>()
  let cursor = 0n
  while (cursor < source.sequence) {
    const batch = await tx
      .select({
        id: botMessage.id,
        sequence: botMessage.sequence,
        speakerKind: botMessage.speaker_kind,
        speakerId: botMessage.speaker_id,
        body: botMessage.body,
        createdAt: botMessage.created_at,
      })
      .from(botMessage)
      .where(and(scope, gt(botMessage.sequence, cursor), lte(botMessage.sequence, source.sequence)))
      .orderBy(asc(botMessage.sequence))
      .limit(100)
    if (!batch.length) break
    await tx.insert(botMessage).values(
      batch.map((message) => {
        const id = randomUUID()
        messages.set(message.id, { id, sequence: message.sequence })
        return {
          id,
          team_id: room.team_id,
          conversation_id: forked.id,
          sequence: message.sequence,
          speaker_kind: message.speakerKind,
          speaker_id: message.speakerId,
          body: message.body,
          created_at: message.createdAt,
        }
      }),
    )
    cursor = batch.at(-1)?.sequence ?? source.sequence
  }
  await cloneBotSessionPrefixes(tx, { teamId: room.team_id, sourceId: room.id, targetId: forked.id }, messages)
  return forked
}
