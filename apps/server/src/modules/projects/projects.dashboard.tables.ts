import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 晴雨表仓库同步进度、来源可用性及 Worker 租约。 */
export const projectDashboardRepository = appSchema.table(
  'project_dashboard_repository',
  {
    id: uuid('id').notNull(),
    next_sync_at: timestamp('next_sync_at', { withTimezone: true, mode: 'date' }).notNull(),
    lease_token: uuid('lease_token'),
    commit_branch: text('commit_branch'),
    commit_head: text('commit_head'),
    commit_from: date('commit_from'),
    commit_checked_at: timestamp('commit_checked_at', { withTimezone: true, mode: 'date' }),
    commits_available: boolean('commits_available').notNull().default(false),
    pull_request_from: date('pull_request_from'),
    pull_request_checked_at: timestamp('pull_request_checked_at', { withTimezone: true, mode: 'date' }),
    pull_request_reconciled_at: timestamp('pull_request_reconciled_at', { withTimezone: true, mode: 'date' }),
    pull_requests_available: boolean('pull_requests_available').notNull().default(false),
    open_pull_requests: integer('open_pull_requests'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_dashboard_repository_id', columns: [table.id] }),
    check('ck_project_dashboard_repository_open', sql`${table.open_pull_requests} >= 0`),
    index('idx_project_dashboard_repository_due').on(table.next_sync_at, table.id),
  ],
)

/** 首页直接读取的仓库活动日计数。 */
export const projectDashboardDay = appSchema.table(
  'project_dashboard_day',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().notNull(),
    repository_id: uuid('repository_id').notNull(),
    source: text('source').notNull(),
    activity_date: date('activity_date').notNull(),
    activity_count: integer('activity_count').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_dashboard_day_id', columns: [table.id] }),
    unique('uk_project_dashboard_day_repository_source_date').on(
      table.repository_id,
      table.source,
      table.activity_date,
    ),
    check('ck_project_dashboard_day_source', sql`${table.source} in ('code', 'pull_request')`),
    check('ck_project_dashboard_day_count', sql`${table.activity_count} > 0`),
  ],
)

/** 晴雨表增量去重所需的最小 PR 事实。 */
export const projectDashboardPullRequest = appSchema.table(
  'project_dashboard_pull_request',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().notNull(),
    repository_id: uuid('repository_id').notNull(),
    remote_number: bigint('remote_number', { mode: 'number' }).notNull(),
    opened_on: date('opened_on').notNull(),
    remote_updated_at: timestamp('remote_updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    is_open: boolean('is_open').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_dashboard_pull_request_id', columns: [table.id] }),
    unique('uk_project_dashboard_pull_request_repository_number').on(table.repository_id, table.remote_number),
    check('ck_project_dashboard_pull_request_number', sql`${table.remote_number} > 0`),
    index('idx_project_dashboard_pull_request_repository_date').on(table.repository_id, table.opened_on),
  ],
)
