import { sql } from 'drizzle-orm'
import {
  bigint,
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

/** 平台创建的一次流水线运行；运行计划与工作流快照在触发时固定。 */
export const pipelineRun = appSchema.table(
  'pipeline_run',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    repository_id: uuid('repository_id').notNull(),
    workflow_path: text('workflow_path').notNull(),
    workflow_name: text('workflow_name'),
    git_ref: text('git_ref').notNull(),
    commit_sha: text('commit_sha').notNull(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
    run_plan: jsonb('run_plan').$type<Record<string, unknown>>().notNull(),
    workflow_snapshot: text('workflow_snapshot').notNull(),
    workflow_hash: text('workflow_hash').notNull(),
    status: text('status').notNull(),
    trigger_source: text('trigger_source').notNull(),
    initiator_channel: text('initiator_channel').notNull(),
    triggered_by_user_id: uuid('triggered_by_user_id').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    node_id: uuid('node_id'),
    timeout_seconds: integer('timeout_seconds').notNull(),
    error_code: text('error_code'),
    error_message: text('error_message'),
    cancel_requested_at: timestamp('cancel_requested_at', { withTimezone: true, mode: 'date' }),
    cancel_requested_by_user_id: uuid('cancel_requested_by_user_id'),
    assigned_at: timestamp('assigned_at', { withTimezone: true, mode: 'date' }),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_run_id', columns: [table.id] }),
    unique('uk_pipeline_run_idempotency').on(table.project_id, table.idempotency_key),
    check(
      'ck_pipeline_run_status',
      sql`${table.status} in ('queued', 'assigned', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted')`,
    ),
    check('ck_pipeline_run_trigger', sql`${table.trigger_source} in ('manual')`),
    check('ck_pipeline_run_channel', sql`${table.initiator_channel} in ('web', 'api')`),
    index('idx_pipeline_run_project_time').on(table.project_id, table.created_at, table.id),
    index('idx_pipeline_run_status').on(table.status, table.created_at),
    index('idx_pipeline_run_node').on(table.node_id, table.status),
  ],
)

/** 运行内步骤的执行事实；静态定义保存在 run_plan 中。 */
export const pipelineRunStep = appSchema.table(
  'pipeline_run_step',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    run_id: uuid('run_id').notNull(),
    step_index: integer('step_index').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    exit_code: integer('exit_code'),
    error_code: text('error_code'),
    error_message: text('error_message'),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_run_step_id', columns: [table.id] }),
    unique('uk_pipeline_run_step').on(table.run_id, table.step_index),
    check(
      'ck_pipeline_run_step_status',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')`,
    ),
    check('ck_pipeline_run_step_kind', sql`${table.kind} in ('run', 'builtin_checkout', 'builtin_upload_artifact')`),
    index('idx_pipeline_run_step_run').on(table.run_id, table.step_index),
  ],
)

/** 日志分片元数据；正文保存在本地存储，不进入数据库。 */
export const pipelineRunLog = appSchema.table(
  'pipeline_run_log',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    run_id: uuid('run_id').notNull(),
    step_index: integer('step_index').notNull(),
    seq: integer('seq').notNull(),
    storage_key: text('storage_key').notNull(),
    size_bytes: integer('size_bytes').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_run_log_id', columns: [table.id] }),
    unique('uk_pipeline_run_log_chunk').on(table.run_id, table.step_index, table.seq),
    check('ck_pipeline_run_log_seq', sql`${table.seq} >= 0 and ${table.step_index} >= 0`),
    index('idx_pipeline_run_log_read').on(table.run_id, table.step_index, table.seq),
  ],
)

/** 平台托管的流水线产物元数据；内容在本地存储。 */
export const pipelineArtifact = appSchema.table(
  'pipeline_artifact',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    run_id: uuid('run_id').notNull(),
    step_index: integer('step_index').notNull(),
    name: text('name').notNull(),
    storage_key: text('storage_key').notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_artifact_id', columns: [table.id] }),
    unique('uk_pipeline_artifact_run_name').on(table.run_id, table.name),
    check('ck_pipeline_artifact_status', sql`${table.status} in ('available', 'missing', 'failed')`),
    check('ck_pipeline_artifact_sha256', sql`char_length(${table.sha256}) = 64`),
    check('ck_pipeline_artifact_size', sql`${table.size_bytes} >= 0`),
    index('idx_pipeline_artifact_run').on(table.run_id, table.created_at, table.id),
  ],
)

/** 注册到团队的执行节点。 */
export const pipelineNode = appSchema.table(
  'pipeline_node',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    os: text('os').notNull(),
    arch: text('arch').notNull(),
    capabilities: text('capabilities')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    concurrency_limit: integer('concurrency_limit').notNull().default(1),
    agent_version: text('agent_version'),
    last_heartbeat_at: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'date' }),
    last_error_code: text('last_error_code'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    disabled_at: timestamp('disabled_at', { withTimezone: true, mode: 'date' }),
    disabled_by_user_id: uuid('disabled_by_user_id'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_node_id', columns: [table.id] }),
    unique('uk_pipeline_node_team_name').on(table.team_id, table.name),
    check('ck_pipeline_node_status', sql`${table.status} in ('pending', 'online', 'draining', 'offline', 'disabled')`),
    check('ck_pipeline_node_concurrency', sql`${table.concurrency_limit} > 0 and ${table.concurrency_limit} <= 1`),
    index('idx_pipeline_node_team_status').on(table.team_id, table.status),
    index('idx_pipeline_node_capabilities').using('gin', table.capabilities),
  ],
)

/** 节点注册令牌与长期 Agent 令牌；只保存哈希。 */
export const pipelineNodeToken = appSchema.table(
  'pipeline_node_token',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    node_id: uuid('node_id').notNull(),
    token_kind: text('token_kind').notNull(),
    token_hash: text('token_hash').notNull(),
    status: text('status').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    used_at: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revoked_by_user_id: uuid('revoked_by_user_id'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_node_token_id', columns: [table.id] }),
    unique('uk_pipeline_node_token_hash').on(table.token_hash),
    check('ck_pipeline_node_token_kind', sql`${table.token_kind} in ('registration', 'agent')`),
    check('ck_pipeline_node_token_status', sql`${table.status} in ('active', 'used', 'revoked', 'expired')`),
    index('idx_pipeline_node_token_node').on(table.node_id, table.token_kind, table.status),
  ],
)

/** 运行与节点之间的调度租约；同一运行最多一个活动租约。 */
export const pipelineLease = appSchema.table(
  'pipeline_lease',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    run_id: uuid('run_id').notNull(),
    node_id: uuid('node_id').notNull(),
    lease_token_hash: text('lease_token_hash').notNull(),
    status: text('status').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    renewed_at: timestamp('renewed_at', { withTimezone: true, mode: 'date' }),
    released_at: timestamp('released_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_lease_id', columns: [table.id] }),
    uniqueIndex('uk_pipeline_lease_active_run')
      .on(table.run_id)
      .where(sql`${table.status} = 'active'`),
    check('ck_pipeline_lease_status', sql`${table.status} in ('active', 'released', 'expired')`),
    index('idx_pipeline_lease_node').on(table.node_id, table.status, table.expires_at),
  ],
)
