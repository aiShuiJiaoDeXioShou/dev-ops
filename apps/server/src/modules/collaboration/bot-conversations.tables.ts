import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'
import { teamAuditColumns } from '../../platform/database/team-audit-columns.ts'

/** Bot 私聊或群组；群组配置一名默认应答 Bot。 */
export const botConversation = appSchema.table(
  'bot_conversation',
  {
    ...teamAuditColumns(),
    kind: text('kind').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    leader_bot_id: uuid('leader_bot_id'),
    responsibility: text('responsibility').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    last_message_at: timestamp('last_message_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    created_by: uuid('created_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_conversation_id', columns: [table.id] }),
    index('idx_bot_conversation_team_last').on(table.team_id, table.last_message_at.desc(), table.id),
    check(
      'ck_bot_conversation_leader',
      sql`
    (${table.kind} = 'direct' and ${table.leader_bot_id} is null) or (${table.kind} = 'group' and ${table.leader_bot_id} is not null)
  `,
    ),
  ],
)

/** 会话的成员关系，移出后保留成员关系历史。 */
export const botConversationMember = appSchema.table(
  'bot_conversation_member',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    member_kind: text('member_kind').notNull(),
    member_id: uuid('member_id').notNull(),
    added_by: uuid('added_by').notNull(),
    removed_at: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_conversation_member_id', columns: [table.id] }),
    uniqueIndex('uk_bot_conversation_member_active')
      .on(table.conversation_id, table.member_kind, table.member_id)
      .where(sql`${table.removed_at} is null`),
    index('idx_bot_conversation_member_access')
      .on(table.team_id, table.member_kind, table.member_id, table.conversation_id)
      .where(sql`${table.removed_at} is null`),
    check('ck_bot_conversation_member_kind', sql`${table.member_kind} in ('user', 'bot')`),
  ],
)

/** 已提交的会话消息，以会话内序号稳定排序。 */
export const botMessage = appSchema.table(
  'bot_message',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    speaker_kind: text('speaker_kind').notNull(),
    speaker_id: uuid('speaker_id'),
    body: jsonb('body').notNull(),
    run_id: uuid('run_id'),
    client_request_id: uuid('client_request_id'),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_message_id', columns: [table.id] }),
    unique('uk_bot_message_sequence').on(table.conversation_id, table.sequence),
    unique('uk_bot_message_client_request').on(table.conversation_id, table.client_request_id),
    check('ck_bot_message_sequence', sql`${table.sequence} > 0`),
    check(
      'ck_bot_message_speaker',
      sql`
    (${table.speaker_kind} in ('user', 'bot') and ${table.speaker_id} is not null)
    or (${table.speaker_kind} = 'system' and ${table.speaker_id} is null)
  `,
    ),
  ],
)

/** 会话增量事件；运行时重试以库内事件序号去重。 */
export const botEvent = appSchema.table(
  'bot_event',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    run_id: uuid('run_id').notNull(),
    run_sequence: integer('run_sequence'),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_event_id', columns: [table.id] }),
    unique('uk_bot_event_sequence').on(table.conversation_id, table.sequence),
    unique('uk_bot_event_run_sequence').on(table.run_id, table.run_sequence),
    check(
      'ck_bot_event_sequence',
      sql`${table.sequence} > 0 and (${table.run_sequence} is null or ${table.run_sequence} > 0)`,
    ),
    check(
      'ck_bot_event_kind',
      sql`${table.kind} in ('run_status', 'output_delta', 'tool_activity', 'message_committed')`,
    ),
  ],
)

/** 团队工作标签，规范化名称用于复用。 */
export const workTag = appSchema.table(
  'work_tag',
  {
    ...teamAuditColumns(),
    name: varchar('name', { length: 40 }).notNull(),
    normalized_name: text('normalized_name').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_work_tag_id', columns: [table.id] }),
    unique('uk_work_tag_team_name').on(table.team_id, table.normalized_name),
  ],
)

/** 标签与会话或任务的关联。 */
export const workTagLink = appSchema.table(
  'work_tag_link',
  {
    ...teamAuditColumns(),
    tag_id: uuid('tag_id').notNull(),
    target_kind: text('target_kind').notNull(),
    target_id: uuid('target_id').notNull(),
    linked_by_kind: text('linked_by_kind').notNull(),
    linked_by_id: uuid('linked_by_id').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_work_tag_link_id', columns: [table.id] }),
    unique('uk_work_tag_link').on(table.tag_id, table.target_kind, table.target_id),
    index('idx_work_tag_link_target').on(table.team_id, table.target_kind, table.target_id),
    check('ck_work_tag_link_target', sql`${table.target_kind} in ('conversation', 'task')`),
    check('ck_work_tag_link_actor', sql`${table.linked_by_kind} in ('user', 'bot')`),
  ],
)
