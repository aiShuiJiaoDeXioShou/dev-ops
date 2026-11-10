import { sql } from 'drizzle-orm'
import { check, index, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 事项评论；正文保存 Markdown 源文本，服务端不渲染 HTML。 */
export const comment = appSchema.table(
  'comment',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id'),
    entity_type: text('entity_type').notNull(),
    entity_id: uuid('entity_id').notNull(),
    author_user_id: uuid('author_user_id').notNull(),
    body_markdown: text('body_markdown').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_comment_id', columns: [table.id] }),
    check('ck_comment_entity_type', sql`${table.entity_type} in ('project', 'requirement', 'bug')`),
    index('idx_comment_entity').on(table.entity_type, table.entity_id, table.created_at, table.id),
    index('idx_comment_team').on(table.team_id),
  ],
)

/** 追加型活动记录；changes 只保存安全字段快照。 */
export const activity = appSchema.table(
  'activity',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id'),
    entity_type: text('entity_type').notNull(),
    entity_id: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    actor_user_id: uuid('actor_user_id').notNull(),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    reason: text('reason'),
    note: text('note'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_activity_id', columns: [table.id] }),
    check(
      'ck_activity_entity_type',
      sql`${table.entity_type} in ('project', 'requirement', 'bug', 'code_reference', 'team_member', 'skill', 'agent_template')`,
    ),
    index('idx_activity_entity').on(table.entity_type, table.entity_id, table.created_at, table.id),
    index('idx_activity_team').on(table.team_id, table.created_at),
  ],
)
