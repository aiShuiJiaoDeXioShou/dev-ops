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

/** 项目内可交付/可运行的服务单元；停用保留历史。 */
export const projectService = appSchema.table(
  'project_service',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_service_id', columns: [table.id] }),
    unique('uk_project_service_project_name').on(table.project_id, table.name),
    check('ck_project_service_status', sql`${table.status} in ('active', 'disabled')`),
    check('ck_project_service_name_length', sql`char_length(${table.name}) between 1 and 120`),
    index('idx_project_service_project_status').on(table.project_id, table.status, table.updated_at, table.id),
    index('idx_project_service_team').on(table.team_id),
  ],
)

/** 服务与项目已关联仓库的多对多映射。 */
export const projectServiceRepository = appSchema.table(
  'project_service_repository',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id').notNull(),
    repository_id: uuid('repository_id').notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_service_repository_id', columns: [table.id] }),
    unique('uk_project_service_repository').on(table.service_id, table.repository_id),
    index('idx_project_service_repository_repository').on(table.repository_id),
    index('idx_project_service_repository_project').on(table.project_id),
  ],
)
