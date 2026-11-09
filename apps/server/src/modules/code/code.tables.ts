import { sql } from 'drizzle-orm'
import { check, index, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.js'

/** 从 Git 连接同步的远端仓库快照。 */
export const gitRepository = appSchema.table(
  'git_repository',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    connection_id: uuid('connection_id').notNull(),
    provider_key: text('provider_key').notNull(),
    remote_repository_id: text('remote_repository_id').notNull(),
    namespace: text('namespace').notNull(),
    name: text('name').notNull(),
    web_url: text('web_url').notNull(),
    default_branch: text('default_branch'),
    status: text('status').notNull().default('available'),
    last_synced_at: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_git_repository_id', columns: [table.id] }),
    unique('uk_git_repository_remote').on(table.connection_id, table.remote_repository_id),
    check('ck_git_repository_status', sql`${table.status} in ('available', 'unavailable', 'removed')`),
    index('idx_git_repository_team').on(table.team_id, table.provider_key),
    index('idx_git_repository_connection').on(table.connection_id),
  ],
)

/** 项目与仓库的显式关联。 */
export const projectRepository = appSchema.table(
  'project_repository',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    repository_id: uuid('repository_id').notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_repository_id', columns: [table.id] }),
    unique('uk_project_repository').on(table.project_id, table.repository_id),
    index('idx_project_repository_repository').on(table.repository_id),
  ],
)

/** 事项与远端 Commit/Issue/PR 的引用及最近核对快照。 */
export const codeReference = appSchema.table(
  'code_reference',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    repository_id: uuid('repository_id').notNull(),
    target_type: text('target_type').notNull(),
    target_id: uuid('target_id').notNull(),
    object_type: text('object_type').notNull(),
    remote_id: text('remote_id').notNull(),
    title_snapshot: text('title_snapshot'),
    state_snapshot: text('state_snapshot'),
    url: text('url'),
    last_checked_at: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    last_check_status: text('last_check_status').notNull().default('unknown'),
    last_error_code: text('last_error_code'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_code_reference_id', columns: [table.id] }),
    unique('uk_code_reference_target').on(
      table.repository_id,
      table.object_type,
      table.remote_id,
      table.target_type,
      table.target_id,
    ),
    check('ck_code_reference_target_type', sql`${table.target_type} in ('requirement', 'bug')`),
    check('ck_code_reference_object_type', sql`${table.object_type} in ('commit', 'issue', 'change_request')`),
    check(
      'ck_code_reference_check_status',
      sql`${table.last_check_status} in ('unknown', 'ok', 'unavailable', 'auth_failed', 'not_found', 'timeout')`,
    ),
    index('idx_code_reference_target').on(table.project_id, table.target_type, table.target_id),
    index('idx_code_reference_repository').on(table.repository_id, table.last_checked_at),
  ],
)
