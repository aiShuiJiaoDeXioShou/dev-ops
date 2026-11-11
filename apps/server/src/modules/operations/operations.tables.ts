import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/**
 * 变更计划：一次生产影响操作的权威记录，放行绑定修订号与内容快照。
 * 同一服务 + 环境在 approved/executing/verifying 状态下最多一条活动计划。
 */
export const changePlan = appSchema.table(
  'change_plan',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id'),
    target_resource: text('target_resource').notNull(),
    environment: text('environment').notNull(),
    operation_kind: text('operation_kind').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull().default(1),
    version_label: text('version_label').notNull(),
    scope_summary: text('scope_summary').notNull(),
    evidence: text('evidence').notNull(),
    rollback_plan: text('rollback_plan').notNull(),
    execution_mode: text('execution_mode').notNull(),
    workflow_path: text('workflow_path'),
    workflow_ref: text('workflow_ref'),
    pipeline_inputs: jsonb('pipeline_inputs').$type<Record<string, unknown>>().notNull().default({}),
    approved_by_user_id: uuid('approved_by_user_id'),
    approved_at: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approved_revision: integer('approved_revision'),
    active_execution_id: uuid('active_execution_id'),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completed_at: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    error_code: text('error_code'),
    error_message: text('error_message'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    version: integer('version').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_change_plan_id', columns: [table.id] }),
    check('ck_change_plan_environment', sql`${table.environment} in ('development', 'test', 'production')`),
    check(
      'ck_change_plan_operation',
      sql`${table.operation_kind} in ('deploy_version', 'database_change', 'server_cleanup', 'cloud_resource_change')`,
    ),
    check(
      'ck_change_plan_status',
      sql`${table.status} in ('pending', 'approved', 'executing', 'verifying', 'completed', 'failed', 'cancelled')`,
    ),
    check('ck_change_plan_mode', sql`${table.execution_mode} in ('platform_pipeline', 'external_system')`),
    check(
      'ck_change_plan_deploy_target',
      sql`(${table.operation_kind} = 'deploy_version' and ${table.service_id} is not null and ${table.workflow_path} is not null) or (${table.operation_kind} <> 'deploy_version' and ${table.service_id} is null)`,
    ),
    check('ck_change_plan_revision', sql`${table.revision} >= 1`),
    check('ck_change_plan_version', sql`${table.version} >= 1`),
    uniqueIndex('uk_change_plan_active_target')
      .on(table.service_id, table.environment)
      .where(sql`${table.service_id} is not null and ${table.status} in ('approved', 'executing', 'verifying')`),
    index('idx_change_plan_team_time').on(table.team_id, table.created_at, table.id),
    index('idx_change_plan_project_time').on(table.project_id, table.created_at, table.id),
    index('idx_change_plan_status').on(table.status, table.updated_at),
  ],
)

/**
 * 放行记录：计划某次修订被人工确认的证据；计划实质变更后置失效，不可复用。
 */
export const changePlanApproval = appSchema.table(
  'change_plan_approval',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    plan_id: uuid('plan_id').notNull(),
    plan_revision: integer('plan_revision').notNull(),
    plan_snapshot: jsonb('plan_snapshot').$type<Record<string, unknown>>().notNull(),
    approved_by_user_id: uuid('approved_by_user_id').notNull(),
    approved_at: timestamp('approved_at', { withTimezone: true, mode: 'date' }).notNull(),
    invalidated_at: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
    invalidated_reason: text('invalidated_reason'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_change_plan_approval_id', columns: [table.id] }),
    unique('uk_change_plan_approval_revision').on(table.plan_id, table.plan_revision),
    index('idx_change_plan_approval_plan').on(table.plan_id, table.approved_at, table.id),
  ],
)

/**
 * 变更执行尝试：计划的一次执行与验证结果；同一计划可多次尝试，但只产生一次发布完成。
 */
export const changeExecution = appSchema.table(
  'change_execution',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    plan_id: uuid('plan_id').notNull(),
    plan_revision: integer('plan_revision').notNull(),
    attempt: integer('attempt').notNull(),
    execution_mode: text('execution_mode').notNull(),
    status: text('status').notNull(),
    pipeline_run_id: uuid('pipeline_run_id'),
    external_ref: text('external_ref'),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    error_code: text('error_code'),
    error_message: text('error_message'),
    verification_status: text('verification_status').notNull().default('pending'),
    health_status: text('health_status'),
    expected_version_label: text('expected_version_label').notNull(),
    actual_version_label: text('actual_version_label'),
    verification_evidence: jsonb('verification_evidence').$type<Record<string, unknown>>(),
    verified_by_user_id: uuid('verified_by_user_id'),
    verified_at: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    verification_note: text('verification_note'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_change_execution_id', columns: [table.id] }),
    unique('uk_change_execution_attempt').on(table.plan_id, table.attempt),
    check('ck_change_execution_attempt', sql`${table.attempt} >= 1`),
    check('ck_change_execution_mode', sql`${table.execution_mode} in ('platform_pipeline', 'external_system')`),
    check(
      'ck_change_execution_status',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'timed_out', 'unverified')`,
    ),
    check('ck_change_execution_verification', sql`${table.verification_status} in ('pending', 'passed', 'failed')`),
    check(
      'ck_change_execution_health',
      sql`${table.health_status} is null or ${table.health_status} in ('ok', 'failing', 'unknown')`,
    ),
    check(
      'ck_change_execution_run',
      sql`(${table.execution_mode} = 'platform_pipeline' and (${table.pipeline_run_id} is not null or ${table.status} in ('queued', 'failed'))) or ${table.execution_mode} = 'external_system'`,
    ),
    index('idx_change_execution_plan').on(table.plan_id, table.attempt),
    index('idx_change_execution_run').on(table.pipeline_run_id),
  ],
)

/**
 * 变更事件：计划操作与状态变化的不可覆盖记录，只增不改。
 * summary 与 payload 不得包含凭据明文、Token、补丁全文或远端响应全文。
 */
export const changePlanEvent = appSchema.table(
  'change_plan_event',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    plan_id: uuid('plan_id').notNull(),
    execution_id: uuid('execution_id'),
    event_type: text('event_type').notNull(),
    actor_user_id: uuid('actor_user_id').notNull(),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_change_plan_event_id', columns: [table.id] }),
    check(
      'ck_change_plan_event_type',
      sql`${table.event_type} in ('created', 'updated', 'approved', 'approval_invalidated', 'execution_started', 'execution_finished', 'verification_failed', 'completed', 'cancelled', 'retry_requested')`,
    ),
    index('idx_change_plan_event_plan').on(table.plan_id, table.created_at, table.id),
  ],
)
