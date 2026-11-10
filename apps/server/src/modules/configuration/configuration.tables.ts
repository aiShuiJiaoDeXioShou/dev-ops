import { sql } from 'drizzle-orm'
import { check, index, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 加密保存的 Git 凭据；业务接口只返回名称、状态与版本。 */
export const secret = appSchema.table(
  'secret',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    auth_tag: text('auth_tag').notNull(),
    key_version: smallint('key_version').notNull(),
    status: text('status').notNull().default('active'),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    rotated_from_id: uuid('rotated_from_id'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_secret_id', columns: [table.id] }),
    check('ck_secret_kind', sql`${table.kind} in ('git_token', 'github_app_private_key')`),
    check('ck_secret_status', sql`${table.status} in ('active', 'revoked')`),
    index('idx_secret_team_kind').on(table.team_id, table.kind, table.status),
  ],
)
