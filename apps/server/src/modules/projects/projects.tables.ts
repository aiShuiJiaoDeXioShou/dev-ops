import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 项目：团队内的业务容器，负责人表示责任而非额外授权。 */
export const project = appSchema.table(
  'project',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    owner_user_id: uuid('owner_user_id').notNull(),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_id', columns: [table.id] }),
    unique('uk_project_team_name').on(table.team_id, table.name),
    check('ck_project_status', sql`${table.status} in ('active', 'paused', 'ended')`),
    index('idx_project_team_status').on(table.team_id, table.status, table.updated_at, table.id),
    index('idx_project_team_updated').on(table.team_id, table.updated_at, table.id),
    index('idx_project_owner').on(table.team_id, table.owner_user_id),
  ],
)
