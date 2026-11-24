import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, jsonb, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'
import { teamAuditColumns } from '../../platform/database/team-audit-columns.ts'

/** 某个会话中某个 Bot 的模型上下文树与同步游标。 */
export const botSession = appSchema.table(
  'bot_session',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    bot_id: uuid('bot_id').notNull(),
    format_version: integer('format_version').notNull().default(3),
    leaf_entry_id: text('leaf_entry_id'),
    synced_message_sequence: bigint('synced_message_sequence', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    seeded_at: timestamp('seeded_at', { withTimezone: true, mode: 'date' }),
    status: text('status').notNull().default('active'),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_session_id', columns: [table.id] }),
    unique('uk_bot_session_conversation_bot').on(table.conversation_id, table.bot_id),
    index('idx_bot_session_team').on(table.team_id),
    check('ck_bot_session_status', sql`${table.status} in ('active', 'detached', 'corrupted')`),
    check('ck_bot_session_sequence', sql`${table.synced_message_sequence} >= 0`),
  ],
)

/** 按写入顺序追加脱敏的会话条目，保留分支和压缩前的历史。 */
export const botSessionEntry = appSchema.table(
  'bot_session_entry',
  {
    ...teamAuditColumns(),
    session_id: uuid('session_id').notNull(),
    entry_id: text('entry_id').notNull(),
    parent_entry_id: text('parent_entry_id'),
    entry_type: text('entry_type').notNull(),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    content: jsonb('content').notNull(),
    source_message_id: uuid('source_message_id'),
    run_id: uuid('run_id'),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_session_entry_id', columns: [table.id] }),
    unique('uk_bot_session_entry_session_entry').on(table.session_id, table.entry_id),
    unique('uk_bot_session_entry_session_sequence').on(table.session_id, table.sequence),
    index('idx_bot_session_entry_source').on(table.session_id, table.source_message_id),
    check('ck_bot_session_entry_sequence', sql`${table.sequence} > 0`),
  ],
)

/** HTTP 进程提交给正在工作的 Bot 的插话或追加。 */
export const botRunInput = appSchema.table(
  'bot_run_input',
  {
    ...teamAuditColumns(),
    run_id: uuid('run_id').notNull(),
    message_id: uuid('message_id').notNull(),
    delivery_mode: text('delivery_mode').notNull(),
    status: text('status').notNull().default('pending'),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_run_input_id', columns: [table.id] }),
    unique('uk_bot_run_input_message').on(table.message_id),
    index('idx_bot_run_input_pending')
      .on(table.run_id)
      .where(sql`${table.status} = 'pending'`),
    check('ck_bot_run_input_mode', sql`${table.delivery_mode} in ('steer', 'follow_up')`),
    check(
      'ck_bot_run_input_status',
      sql`${table.status} in ('pending', 'delivering', 'delivered', 'requeued', 'withdrawn')`,
    ),
  ],
)
