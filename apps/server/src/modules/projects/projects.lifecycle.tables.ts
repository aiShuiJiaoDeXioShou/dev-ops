import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 每次项目移入回收站对应一代文件清理任务，保留结果供审计。 */
export const projectFileCleanup = appSchema.table(
  'project_file_cleanup',
  {
    id: uuid('id').notNull(),
    project_id: uuid('project_id').notNull(),
    team_id: uuid('team_id').notNull(),
    delete_version: integer('delete_version').notNull(),
    requested_by_user_id: uuid('requested_by_user_id').notNull(),
    status: text('status').notNull().default('queued'),
    lease_token: uuid('lease_token'),
    lease_until: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_file_cleanup_id', columns: [table.id] }),
    unique('uk_project_file_cleanup_version').on(table.project_id, table.delete_version),
    index('idx_project_file_cleanup_queue').on(table.status, table.lease_until, table.created_at),
    check('ck_project_file_cleanup_status', sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`),
    check(
      'ck_project_file_cleanup_lease',
      sql`(${table.status} = 'running' and ${table.lease_token} is not null and ${table.lease_until} is not null)
        or (${table.status} <> 'running' and ${table.lease_token} is null and ${table.lease_until} is null)`,
    ),
  ],
)

/** 两种项目密码确认共用账号限流窗口，只记录计数。 */
export const projectPasswordLimit = appSchema.table(
  'project_password_limit',
  {
    id: uuid('id').notNull(),
    window_start: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    attempts: integer('attempts').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_password_limit_id', columns: [table.id] }),
    check('ck_project_password_limit_attempts', sql`${table.attempts} > 0`),
  ],
)
