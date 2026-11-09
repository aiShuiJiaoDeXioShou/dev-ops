import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.js'

/** 需求：项目内的事项，编号在项目内稳定。 */
export const requirement = appSchema.table(
  'requirement',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    content_mode: text('content_mode').notNull(),
    content_markdown: text('content_markdown'),
    external_url: text('external_url'),
    external_summary: text('external_summary'),
    acceptance_criteria: text('acceptance_criteria'),
    dev_owner_user_id: uuid('dev_owner_user_id'),
    test_owner_user_id: uuid('test_owner_user_id'),
    status: text('status').notNull().default('pending'),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_requirement_id', columns: [table.id] }),
    unique('uk_requirement_project_number').on(table.project_id, table.number),
    check('ck_requirement_content_mode', sql`${table.content_mode} in ('markdown', 'external_link')`),
    check(
      'ck_requirement_status',
      sql`${table.status} in ('pending', 'in_development', 'submitted', 'in_testing', 'passed', 'cancelled')`,
    ),
    check(
      'ck_requirement_content_fields',
      sql`(
    (${table.content_mode} = 'markdown' AND ${table.content_markdown} IS NOT NULL AND length(btrim(${table.content_markdown})) > 0)
    OR (${table.content_mode} = 'external_link' AND ${table.external_url} IS NOT NULL AND length(btrim(${table.external_url})) > 0)
  )`,
    ),
    index('idx_requirement_project_status').on(table.project_id, table.status, table.updated_at, table.id),
    index('idx_requirement_project_owner').on(table.project_id, table.dev_owner_user_id),
    index('idx_requirement_team').on(table.team_id),
  ],
)

/** 需求协作人员，可有多名。 */
export const requirementCollaborator = appSchema.table(
  'requirement_collaborator',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    requirement_id: uuid('requirement_id').notNull(),
    user_id: uuid('user_id').notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_requirement_collaborator_id', columns: [table.id] }),
    unique('uk_requirement_collaborator').on(table.requirement_id, table.user_id),
    index('idx_requirement_collaborator_user').on(table.user_id),
  ],
)

/** 需求提测记录；每次提测保留一条历史。 */
export const requirementTestSubmission = appSchema.table(
  'requirement_test_submission',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    requirement_id: uuid('requirement_id').notNull(),
    submitted_by_user_id: uuid('submitted_by_user_id').notNull(),
    dev_owner_user_id: uuid('dev_owner_user_id').notNull(),
    test_owner_user_id: uuid('test_owner_user_id').notNull(),
    scope_note: text('scope_note').notNull(),
    self_test_result: text('self_test_result').notNull(),
    self_test_note: text('self_test_note'),
    test_entry: text('test_entry'),
    version_note: text('version_note'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_requirement_test_submission_id', columns: [table.id] }),
    check(
      'ck_requirement_test_submission_result',
      sql`${table.self_test_result} in ('passed', 'has_failures', 'not_run', 'not_applicable')`,
    ),
    check(
      'ck_requirement_test_submission_note',
      sql`${table.self_test_result} = 'passed' OR (${table.self_test_note} IS NOT NULL AND length(btrim(${table.self_test_note})) > 0)`,
    ),
    index('idx_requirement_test_submission_requirement').on(table.requirement_id, table.created_at),
  ],
)
