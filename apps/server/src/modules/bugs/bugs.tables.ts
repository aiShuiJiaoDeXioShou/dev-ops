import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 内部 Bug；现象、预期与复现信息是建单必填的业务事实。 */
export const bug = appSchema.table(
  'bug',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    phenomenon: text('phenomenon').notNull(),
    expected_behavior: text('expected_behavior').notNull(),
    reproduction: text('reproduction'),
    reproduction_unknown: boolean('reproduction_unknown').notNull().default(false),
    evidence_text: text('evidence_text'),
    evidence_url: text('evidence_url'),
    fix_owner_user_id: uuid('fix_owner_user_id'),
    regression_owner_user_id: uuid('regression_owner_user_id'),
    status: text('status').notNull().default('pending'),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_bug_id', columns: [table.id] }),
    unique('uk_bug_project_number').on(table.project_id, table.number),
    check('ck_bug_status', sql`${table.status} in ('pending', 'in_fix', 'in_regression', 'resolved', 'closed')`),
    check(
      'ck_bug_reproduction',
      sql`(${table.reproduction_unknown} = true) OR (${table.reproduction} IS NOT NULL AND length(btrim(${table.reproduction})) > 0)`,
    ),
    index('idx_bug_project_status').on(table.project_id, table.status, table.updated_at, table.id),
    index('idx_bug_project_updated').on(table.project_id, table.updated_at, table.id),
    index('idx_bug_project_owner').on(table.project_id, table.fix_owner_user_id),
    index('idx_bug_team').on(table.team_id),
  ],
)

/** Bug 与同项目需求的关联。 */
export const bugRequirementLink = appSchema.table(
  'bug_requirement_link',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    bug_id: uuid('bug_id').notNull(),
    requirement_id: uuid('requirement_id').notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_bug_requirement_link_id', columns: [table.id] }),
    unique('uk_bug_requirement_link').on(table.bug_id, table.requirement_id),
    index('idx_bug_requirement_link_requirement').on(table.requirement_id),
  ],
)

/** Bug 修复与回归记录。 */
export const bugRegression = appSchema.table(
  'bug_regression',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    bug_id: uuid('bug_id').notNull(),
    attempt: integer('attempt').notNull(),
    fix_summary: text('fix_summary').notNull(),
    fixer_user_id: uuid('fixer_user_id').notNull(),
    verifier_user_id: uuid('verifier_user_id').notNull(),
    result: text('result').notNull().default('pending'),
    failure_reason: text('failure_reason'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    verified_at: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ name: 'pk_bug_regression_id', columns: [table.id] }),
    unique('uk_bug_regression_attempt').on(table.bug_id, table.attempt),
    uniqueIndex('uk_bug_regression_pending')
      .on(table.bug_id)
      .where(sql`${table.result} = 'pending'`),
    check('ck_bug_regression_result', sql`${table.result} in ('pending', 'passed', 'failed', 'withdrawn')`),
    index('idx_bug_regression_bug').on(table.bug_id, table.created_at),
  ],
)
