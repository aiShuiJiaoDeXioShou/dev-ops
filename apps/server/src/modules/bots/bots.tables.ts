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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'
import { teamAuditColumns } from '../../platform/database/team-audit-columns.ts'

/** 全局模型目录使用零值 UUID 作为团队归属。 */
export const GLOBAL_BOT_CATALOG_TEAM_ID = '00000000-0000-0000-0000-000000000000'

/** 团队 Bot 的配置及版本。 */
export const bot = appSchema.table(
  'bot',
  {
    ...teamAuditColumns(),
    name: varchar('name', { length: 60 }).notNull(),
    avatar_key: text('avatar_key'),
    responsibility: text('responsibility').notNull(),
    instructions: text('instructions').notNull().default(''),
    owner_user_id: uuid('owner_user_id').notNull(),
    model_connection_id: uuid('model_connection_id'),
    model_id: text('model_id'),
    access_mode: text('access_mode').notNull().default('sandbox'),
    status: text('status').notNull().default('enabled'),
    config_version: integer('config_version').notNull().default(1),
    created_by: uuid('created_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_id', columns: [table.id] }),
    unique('uk_bot_team_name').on(table.team_id, table.name),
    index('idx_bot_team_owner').on(table.team_id, table.owner_user_id),
    check('ck_bot_status', sql`${table.status} in ('enabled', 'disabled')`),
    check('ck_bot_access_mode', sql`${table.access_mode} in ('sandbox', 'full')`),
    check('ck_bot_model_pair', sql`(${table.model_connection_id} is null) = (${table.model_id} is null)`),
    check('ck_bot_config_version', sql`${table.config_version} >= 1`),
  ],
)

/** Bot 可用技能的配置关系。 */
export const botSkill = appSchema.table(
  'bot_skill',
  {
    ...teamAuditColumns(),
    bot_id: uuid('bot_id').notNull(),
    skill_id: uuid('skill_id').notNull(),
    configured_by: uuid('configured_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_skill_id', columns: [table.id] }),
    unique('uk_bot_skill').on(table.bot_id, table.skill_id),
  ],
)

/** 模型凭据引用或 OAuth 密文，以及连接的可用状态。 */
export const botModelConnection = appSchema.table(
  'bot_model_connection',
  {
    ...teamAuditColumns(),
    name: varchar('name', { length: 60 }).notNull(),
    provider_id: text('provider_id').notNull(),
    auth_type: text('auth_type').notNull(),
    credential_id: uuid('credential_id'),
    oauth_secret: text('oauth_secret'),
    login_user_id: uuid('login_user_id'),
    status: text('status').notNull(),
    disabled_reason: text('disabled_reason'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_model_connection_id', columns: [table.id] }),
    unique('uk_bot_model_connection_team_name').on(table.team_id, table.name),
    index('idx_bot_model_connection_login_user').on(table.team_id, table.login_user_id),
    check(
      'ck_bot_model_connection_auth',
      sql`
    (${table.auth_type} = 'api_key' and ${table.credential_id} is not null
      and ${table.oauth_secret} is null and ${table.login_user_id} is null)
    or (${table.auth_type} = 'oauth' and ${table.login_user_id} is not null and ${table.credential_id} is null)
  `,
    ),
    check('ck_bot_model_connection_status', sql`${table.status} in ('active', 'disabled', 'login_failed')`),
    check(
      'ck_bot_model_connection_reason',
      sql`${table.disabled_reason} in ('manual', 'login_user_demoted', 'auth_expired')`,
    ),
    check('ck_bot_model_connection_version', sql`${table.version} >= 1`),
  ],
)

/** 订阅授权的临时会话，回调码加密且消费后清空。 */
export const botLoginSession = appSchema.table(
  'bot_login_session',
  {
    ...teamAuditColumns(),
    connection_id: uuid('connection_id').notNull(),
    status: text('status').notNull().default('pending'),
    prompt: jsonb('prompt'),
    answer_secret: text('answer_secret'),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lease_owner: text('lease_owner'),
    lease_until: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_login_session_id', columns: [table.id] }),
    index('idx_bot_login_session_status_expires').on(table.status, table.expires_at),
    check(
      'ck_bot_login_session_status',
      sql`${table.status} in ('pending', 'waiting_user', 'succeeded', 'failed', 'expired')`,
    ),
  ],
)

/** 执行服务上报的全局模型目录快照。 */
export const botModelCatalog = appSchema.table(
  'bot_model_catalog',
  {
    ...teamAuditColumns(),
    team_id: uuid('team_id').notNull().default(GLOBAL_BOT_CATALOG_TEAM_ID),
    provider_id: text('provider_id').notNull(),
    model_id: text('model_id').notNull(),
    display_name: text('display_name').notNull(),
    auth_types: text('auth_types').array().notNull(),
    context_window: integer('context_window'),
    reported_at: timestamp('reported_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_model_catalog_id', columns: [table.id] }),
    unique('uk_bot_model_catalog').on(table.provider_id, table.model_id),
    check('ck_bot_model_catalog_global', sql`${table.team_id} = '00000000-0000-0000-0000-000000000000'::uuid`),
    check('ck_bot_model_catalog_context', sql`${table.context_window} > 0`),
    check('ck_bot_model_catalog_auth_types', sql`${table.auth_types} <@ array['api_key', 'oauth']::text[]`),
  ],
)

/** 单次执行及领取代次、配置快照、终态与用量。 */
export const botRun = appSchema.table(
  'bot_run',
  {
    ...teamAuditColumns(),
    conversation_id: uuid('conversation_id'),
    task_id: uuid('task_id'),
    bot_id: uuid('bot_id').notNull(),
    trigger_user_id: uuid('trigger_user_id').notNull(),
    trigger_message_id: uuid('trigger_message_id'),
    input_version: integer('input_version').notNull(),
    kind: text('kind').notNull().default('reply'),
    relay_id: uuid('relay_id'),
    relay_role: text('relay_role'),
    hop: integer('hop'),
    resume_count: integer('resume_count').notNull().default(0),
    is_skipped: boolean('is_skipped').notNull().default(false),
    relay_mentions: jsonb('relay_mentions'),
    status: text('status').notNull().default('queued'),
    failure_kind: text('failure_kind'),
    failure_message: text('failure_message'),
    config_snapshot: jsonb('config_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    lease_owner: text('lease_owner'),
    lease_until: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    lease_epoch: integer('lease_epoch').notNull().default(0),
    stop_requested: boolean('stop_requested').notNull().default(false),
    turns: integer('turns').notNull().default(0),
    usage: jsonb('usage'),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_run_id', columns: [table.id] }),
    uniqueIndex('uk_bot_run_conversation_running')
      .on(table.conversation_id)
      .where(sql`${table.conversation_id} is not null and ${table.status} = 'running'`),
    uniqueIndex('uk_bot_run_bot_consolidation_running')
      .on(table.bot_id)
      .where(sql`${table.kind} = 'memory_consolidation' and ${table.status} = 'running'`),
    index('idx_bot_run_queue').on(table.status, table.created_at, table.id),
    index('idx_bot_run_team_status').on(table.team_id, table.status),
    index('idx_bot_run_task').on(table.task_id, table.created_at),
    index('idx_bot_run_relay').on(table.relay_id, table.status),
    index('idx_bot_run_leased')
      .on(table.lease_until)
      .where(sql`${table.status} = 'running'`),
    check('ck_bot_run_status', sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'stopped')`),
    check(
      'ck_bot_run_failure',
      sql`
    (${table.status} = 'failed') = (${table.failure_kind} is not null)
    and (${table.failure_kind} is null or ${table.failure_kind} in
      ('model_error', 'model_quota', 'timeout', 'turn_limit', 'execution_interrupted', 'model_unavailable', 'tool_error',
       'budget_exhausted', 'session_unavailable', 'context_overflow'))
  `,
    ),
    check(
      'ck_bot_run_counters',
      sql`${table.input_version} >= 0 and ${table.lease_epoch} >= 0 and ${table.turns} >= 0`,
    ),
    check('ck_bot_run_kind', sql`${table.kind} in ('reply', 'task', 'compact', 'memory_consolidation')`),
    check(
      'ck_bot_run_conversation',
      sql`(${table.kind} = 'memory_consolidation') = (${table.conversation_id} is null)`,
    ),
    check('ck_bot_run_resume_count', sql`${table.resume_count} between 0 and 2`),
    check('ck_bot_run_relay_role', sql`${table.relay_role} in ('leader', 'mention', 'all', 'relay')`),
  ],
)

/** 脱敏的工具调用记录，可按幂等键识别重试。 */
export const botApiCall = appSchema.table(
  'bot_api_call',
  {
    ...teamAuditColumns(),
    run_id: uuid('run_id').notNull(),
    kind: text('kind').notNull(),
    method: text('method'),
    target: text('target').notNull(),
    idempotency_key: text('idempotency_key'),
    input_summary: text('input_summary').notNull(),
    status: text('status').notNull(),
    result_code: text('result_code'),
    result_ref: jsonb('result_ref'),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_api_call_id', columns: [table.id] }),
    unique('uk_bot_api_call_idem').on(table.run_id, table.idempotency_key),
    check(
      'ck_bot_api_call_kind',
      sql`${table.kind} in ('platform_api', 'web_search', 'web_fetch', 'memory', 'task_result')`,
    ),
    check('ck_bot_api_call_status', sql`${table.status} in ('succeeded', 'failed', 'rejected', 'unknown')`),
    check(
      'ck_bot_api_call_method',
      sql`
    (${table.kind} = 'platform_api' and ${table.method} is not null and ${table.method} in ('GET', 'POST'))
    or (${table.kind} <> 'platform_api' and ${table.method} is null)
  `,
    ),
  ],
)

/** 按 Bot 或成员归属隔离的长期记忆。 */
export const botMemory = appSchema.table(
  'bot_memory',
  {
    ...teamAuditColumns(),
    bot_id: uuid('bot_id').notNull(),
    scope: text('scope').notNull(),
    user_id: uuid('user_id'),
    content: varchar('content', { length: 2000 }).notNull(),
    normalized_content: text('normalized_content').notNull(),
    essential: boolean('essential').notNull().default(false),
    source_conversation_id: uuid('source_conversation_id'),
    source_user_id: uuid('source_user_id').notNull(),
    source_kind: text('source_kind').notNull().default('conversation'),
    source_detail: jsonb('source_detail'),
    updated_by_kind: text('updated_by_kind').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_memory_id', columns: [table.id] }),
    uniqueIndex('uk_bot_memory_scope_content').on(
      table.bot_id,
      table.scope,
      sql`coalesce(${table.user_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.normalized_content,
    ),
    index('idx_bot_memory_trgm').using('gin', table.normalized_content.op('gin_trgm_ops')),
    index('idx_bot_memory_bot_scope').on(table.bot_id, table.scope, table.user_id),
    check(
      'ck_bot_memory_scope',
      sql`
    (${table.scope} = 'user' and ${table.user_id} is not null) or (${table.scope} = 'bot' and ${table.user_id} is null)
  `,
    ),
    check('ck_bot_memory_updater', sql`${table.updated_by_kind} in ('bot', 'user')`),
    check('ck_bot_memory_source', sql`${table.source_kind} in ('conversation', 'consolidation')`),
  ],
)
