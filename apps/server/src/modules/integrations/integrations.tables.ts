import { sql } from 'drizzle-orm'
import { check, index, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 团队 Git 连接；授权凭据只保存 secret 引用。 */
export const gitConnection = appSchema.table(
  'git_connection',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    provider_key: text('provider_key').notNull(),
    instance_url: text('instance_url').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    auth_kind: text('auth_kind').notNull(),
    external_identity: text('external_identity'),
    secret_id: uuid('secret_id'),
    repository_scope_synced_at: timestamp('repository_scope_synced_at', { withTimezone: true, mode: 'date' }),
    last_checked_at: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    last_error_code: text('last_error_code'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_git_connection_id', columns: [table.id] }),
    unique('uk_git_connection_team_name').on(table.team_id, table.name),
    check('ck_git_connection_provider', sql`${table.provider_key} in ('github', 'gitea')`),
    check('ck_git_connection_status', sql`${table.status} in ('active', 'invalid', 'revoked')`),
    check(
      'ck_git_connection_auth_kind',
      sql`${table.auth_kind} in ('github_app_installation', 'github_cli', 'gitea_token')`,
    ),
    index('idx_git_connection_team_status').on(table.team_id, table.status),
  ],
)
