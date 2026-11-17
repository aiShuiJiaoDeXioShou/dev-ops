import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'
import { teamAuditColumns } from '../../platform/database/team-audit-columns.ts'

/** 会话中的显式任务及其执行、等待和验收状态。 */
export const botTask = appSchema.table(
  'bot_task',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    acceptance_criteria: text('acceptance_criteria').notNull(),
    business_owner_id: uuid('business_owner_id').notNull(),
    executor_bot_id: uuid('executor_bot_id').notNull(),
    status: text('status').notNull().default('pending'),
    wait_reason: text('wait_reason'),
    blocked: boolean('blocked').notNull().default(false),
    input_version: integer('input_version').notNull().default(1),
    version: integer('version').notNull().default(1),
    tagged_at: timestamp('tagged_at', { withTimezone: true, mode: 'date' }),
    created_by: uuid('created_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_task_id', columns: [table.id] }),
    index('idx_bot_task_conversation').on(table.conversation_id, table.created_at, table.id),
    index('idx_bot_task_team_executor').on(table.team_id, table.executor_bot_id, table.status),
    index('idx_bot_task_team_inbox')
      .on(table.team_id, table.updated_at.desc(), table.id)
      .where(sql`${table.status} = 'awaiting_review' or ${table.blocked}`),
    check(
      'ck_bot_task_status',
      sql`${table.status} in ('pending', 'in_progress', 'waiting', 'awaiting_review', 'completed', 'cancelled')`,
    ),
    check(
      'ck_bot_task_wait_reason',
      sql`
    (${table.status} = 'waiting') = (${table.wait_reason} is not null)
    and (${table.wait_reason} is null or ${table.wait_reason} in ('needs_input', 'run_failed', 'executor_unavailable', 'stopped'))
  `,
    ),
    check('ck_bot_task_version', sql`${table.version} >= 1 and ${table.input_version} >= 1`),
  ],
)

/** 不可变的初始要求及后续补充。 */
export const botTaskInput = appSchema.table(
  'bot_task_input',
  {
    ...teamAuditColumns(),
    task_id: uuid('task_id').notNull(),
    input_version: integer('input_version').notNull(),
    content: text('content').notNull(),
    created_by: uuid('created_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_task_input_id', columns: [table.id] }),
    unique('uk_bot_task_input_version').on(table.task_id, table.input_version),
    check('ck_bot_task_input_version', sql`${table.input_version} >= 1`),
  ],
)

/** 不可变的任务转交和未完成事项记录。 */
export const botTaskHandoff = appSchema.table(
  'bot_task_handoff',
  {
    ...teamAuditColumns(),
    task_id: uuid('task_id').notNull(),
    from_bot_id: uuid('from_bot_id').notNull(),
    to_bot_id: uuid('to_bot_id').notNull(),
    reason: text('reason').notNull(),
    summary: text('summary').notNull(),
    unfinished: text('unfinished').notNull(),
    created_by: uuid('created_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_task_handoff_id', columns: [table.id] }),
    index('idx_bot_task_handoff_task').on(table.task_id, table.created_at, table.id),
    check('ck_bot_task_handoff_executor', sql`${table.from_bot_id} <> ${table.to_bot_id}`),
  ],
)

/** Bot 提交的不可变任务结果、说明和验收依据。 */
export const botTaskResult = appSchema.table(
  'bot_task_result',
  {
    ...teamAuditColumns(),
    task_id: uuid('task_id').notNull(),
    run_id: uuid('run_id').notNull(),
    body: text('body').notNull(),
    completion_note: text('completion_note').notNull(),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'[]'::jsonb`),
    submitted_by_bot_id: uuid('submitted_by_bot_id').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_task_result_id', columns: [table.id] }),
    unique('uk_bot_task_result_run').on(table.run_id),
    index('idx_bot_task_result_task').on(table.task_id, table.created_at, table.id),
  ],
)

/** 人工验收或退回记录，每份结果只允许一个决定。 */
export const botTaskReview = appSchema.table(
  'bot_task_review',
  {
    ...teamAuditColumns(),
    task_id: uuid('task_id').notNull(),
    result_id: uuid('result_id').notNull(),
    decision: text('decision').notNull(),
    comment: text('comment'),
    reviewer_user_id: uuid('reviewer_user_id').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_task_review_id', columns: [table.id] }),
    unique('uk_bot_task_review_result').on(table.result_id),
    index('idx_bot_task_review_task').on(table.task_id, table.created_at, table.id),
    check('ck_bot_task_review_decision', sql`${table.decision} in ('accepted', 'changes_requested')`),
  ],
)
