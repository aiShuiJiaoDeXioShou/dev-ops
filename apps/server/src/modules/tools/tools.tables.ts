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
 * 项目写能力授权：按项目 × 用户 × 具体能力授权，默认不开启。
 * 撤销只写 revoked_at 并保留历史行；部分唯一索引保证同一授权只有一条有效记录。
 */
export const projectCapabilityGrant = appSchema.table(
  'project_capability_grant',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    grantee_user_id: uuid('grantee_user_id').notNull(),
    capability: text('capability').notNull(),
    granted_by_user_id: uuid('granted_by_user_id').notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revoked_by_user_id: uuid('revoked_by_user_id'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_capability_grant_id', columns: [table.id] }),
    check(
      'ck_project_capability_grant_capability',
      sql`${table.capability} in ('code_change', 'create_pull_request', 'create_issue', 'add_comment')`,
    ),
    uniqueIndex('uk_project_capability_grant_active')
      .on(table.project_id, table.grantee_user_id, table.capability)
      .where(sql`${table.revoked_at} is null`),
    index('idx_project_capability_grant_user').on(table.grantee_user_id, table.team_id, table.revoked_at),
    index('idx_project_capability_grant_project').on(table.project_id, table.created_at, table.id),
  ],
)

/**
 * 项目写能力调用记录：一次写能力调用的权威证据与幂等锚点。
 * 不保存补丁正文、凭据、Token 或远端响应全文；只保存可核对标识与摘要。
 */
export const toolInvocation = appSchema.table(
  'tool_invocation',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    capability: text('capability').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    request_fingerprint: text('request_fingerprint').notNull(),
    repository_id: uuid('repository_id'),
    target_ref: text('target_ref'),
    input_summary: jsonb('input_summary').$type<Record<string, unknown>>().notNull().default({}),
    result_ref: jsonb('result_ref').$type<Record<string, unknown>>(),
    error_code: text('error_code'),
    error_message: text('error_message'),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_tool_invocation_id', columns: [table.id] }),
    unique('uk_tool_invocation_idempotency').on(table.project_id, table.idempotency_key),
    check(
      'ck_tool_invocation_capability',
      sql`${table.capability} in ('code_change', 'create_pull_request', 'create_issue', 'add_comment')`,
    ),
    check('ck_tool_invocation_channel', sql`${table.channel} in ('web', 'cli')`),
    check(
      'ck_tool_invocation_status',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain')`,
    ),
    index('idx_tool_invocation_project_time').on(table.project_id, table.created_at, table.id),
    index('idx_tool_invocation_status').on(table.status, table.created_at),
  ],
)

/**
 * 受控代码修改：在独立执行环境中完成补丁校验、应用、校验、差异收集与分支推送。
 * 补丁入库后不可修改；工作分支不得等于基线分支。
 */
export const codeChange = appSchema.table(
  'code_change',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    repository_id: uuid('repository_id').notNull(),
    invocation_id: uuid('invocation_id').notNull(),
    base_ref: text('base_ref').notNull(),
    base_sha: text('base_sha').notNull(),
    branch_name: text('branch_name').notNull(),
    commit_message: text('commit_message').notNull(),
    author_name: text('author_name').notNull(),
    author_email: text('author_email').notNull(),
    patch: text('patch').notNull(),
    patch_sha256: text('patch_sha256').notNull(),
    patch_size_bytes: integer('patch_size_bytes').notNull(),
    validation_workflow_path: text('validation_workflow_path').notNull(),
    status: text('status').notNull(),
    pipeline_run_id: uuid('pipeline_run_id'),
    diff_storage_key: text('diff_storage_key'),
    diff_sha256: text('diff_sha256'),
    diff_size_bytes: integer('diff_size_bytes'),
    validation_result: jsonb('validation_result').$type<Record<string, unknown>>(),
    pull_request_number: integer('pull_request_number'),
    pull_request_url: text('pull_request_url'),
    error_code: text('error_code'),
    error_message: text('error_message'),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_code_change_id', columns: [table.id] }),
    unique('uk_code_change_invocation').on(table.invocation_id),
    check('ck_code_change_status', sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`),
    check('ck_code_change_patch_size', sql`${table.patch_size_bytes} > 0 and ${table.patch_size_bytes} <= 1048576`),
    check('ck_code_change_branch', sql`${table.branch_name} <> ${table.base_ref}`),
    index('idx_code_change_project_time').on(table.project_id, table.created_at, table.id),
    index('idx_code_change_run').on(table.pipeline_run_id),
  ],
)
