import { sql } from 'drizzle-orm'
import { check, integer, jsonb, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'
import { teamAuditColumns } from '../../platform/database/team-audit-columns.ts'

/** 一条成员消息触发的有序 Bot 回复和接力。 */
export const botRoomRelay = appSchema.table(
  'bot_room_relay',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    origin_message_id: uuid('origin_message_id').notNull(),
    trigger_user_id: uuid('trigger_user_id').notNull(),
    status: text('status').notNull().default('running'),
    end_reason: text('end_reason'),
    hop_count: integer('hop_count').notNull().default(0),
    reply_count: integer('reply_count').notNull().default(0),
    continue_count: integer('continue_count').notNull().default(0),
    pending_bot_ids: jsonb('pending_bot_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_room_relay_id', columns: [table.id] }),
    uniqueIndex('uk_bot_room_relay_conversation_active')
      .on(table.conversation_id)
      .where(sql`${table.status} in ('running', 'paused')`),
    check('ck_bot_room_relay_status', sql`${table.status} in ('running', 'paused', 'finished', 'stopped')`),
    check(
      'ck_bot_room_relay_counts',
      sql`${table.hop_count} >= 0 and ${table.reply_count} >= 0 and ${table.continue_count} >= 0 and ${table.version} > 0`,
    ),
    check('ck_bot_room_relay_pending', sql`jsonb_typeof(${table.pending_bot_ids}) = 'array'`),
    check(
      'ck_bot_room_relay_reason',
      sql`(${table.status} in ('finished', 'stopped')) = (${table.end_reason} is not null) and (${table.end_reason} is null or ${table.end_reason} in ('completed', 'limit', 'stopped_by_member', 'budget_exhausted', 'ended_by_member'))`,
    ),
  ],
)

/** 会话为某个 Bot 选择的模型与思考等级覆盖。 */
export const botConversationBotSetting = appSchema.table(
  'bot_conversation_bot_setting',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    bot_id: uuid('bot_id').notNull(),
    model_id: text('model_id'),
    thinking_level: text('thinking_level'),
    updated_by: uuid('updated_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_conversation_bot_setting_id', columns: [table.id] }),
    unique('uk_bot_conversation_bot_setting').on(table.conversation_id, table.bot_id),
    check(
      'ck_bot_conversation_bot_thinking',
      sql`${table.thinking_level} in ('off', 'minimal', 'low', 'medium', 'high', 'xhigh')`,
    ),
  ],
)
