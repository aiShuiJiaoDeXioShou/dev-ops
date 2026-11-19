import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'
import { teamAuditColumns } from '../../platform/database/team-audit-columns.ts'

/** 团队管理员维护并由团队 Bot 共享的上下文。 */
export const teamBotContext = appSchema.table(
  'team_bot_context',
  {
    ...teamAuditColumns(),
    content: text('content').notNull(),
    updated_by: uuid('updated_by').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ name: 'pk_team_bot_context_id', columns: [table.id] }),
    unique('uk_team_bot_context_team').on(table.team_id),
    check('ck_team_bot_context_length', sql`octet_length(${table.content}) <= 16384`),
    check('ck_team_bot_context_version', sql`${table.version} > 0`),
  ],
)

/** 成员可在会话中选择的团队提示模板。 */
export const botPromptTemplate = appSchema.table(
  'bot_prompt_template',
  {
    ...teamAuditColumns(),
    name: varchar('name', { length: 40 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    body: text('body').notNull(),
    created_by: uuid('created_by').notNull(),
    updated_by: uuid('updated_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_prompt_template_id', columns: [table.id] }),
    unique('uk_bot_prompt_template_team_name').on(table.team_id, table.name),
    check('ck_bot_prompt_template_name', sql`${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
)

/** 团队远程 MCP 配置，只保存凭据引用。 */
export const botMcpServer = appSchema.table(
  'bot_mcp_server',
  {
    ...teamAuditColumns(),
    name: varchar('name', { length: 40 }).notNull(),
    url: text('url').notNull(),
    credential_id: uuid('credential_id'),
    exposure: text('exposure').notNull(),
    status: text('status').notNull().default('enabled'),
    bot_ids: jsonb('bot_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    created_by: uuid('created_by').notNull(),
    updated_by: uuid('updated_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_mcp_server_id', columns: [table.id] }),
    unique('uk_bot_mcp_server_team_name').on(table.team_id, table.name),
    check('ck_bot_mcp_server_exposure', sql`${table.exposure} in ('direct', 'deferred')`),
    check('ck_bot_mcp_server_status', sql`${table.status} in ('enabled', 'disabled')`),
    check('ck_bot_mcp_server_bot_ids', sql`jsonb_typeof(${table.bot_ids}) = 'array'`),
  ],
)

/** 团队每个 UTC 自然月的美元预算。 */
export const teamBotBudget = appSchema.table(
  'team_bot_budget',
  {
    ...teamAuditColumns(),
    monthly_limit_usd: numeric('monthly_limit_usd', { precision: 12, scale: 4 }),
    updated_by: uuid('updated_by').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_team_bot_budget_id', columns: [table.id] }),
    unique('uk_team_bot_budget_team').on(table.team_id),
    check('ck_team_bot_budget_positive', sql`${table.monthly_limit_usd} >= 0`),
  ],
)

/** 按团队、Bot 和 UTC 日期汇总已结束的模型用量。 */
export const botUsageDaily = appSchema.table(
  'bot_usage_daily',
  {
    ...teamAuditColumns(),
    bot_id: uuid('bot_id').notNull(),
    usage_date: date('usage_date').notNull(),
    input_tokens: bigint('input_tokens', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    output_tokens: bigint('output_tokens', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    cache_read_tokens: bigint('cache_read_tokens', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    cache_write_tokens: bigint('cache_write_tokens', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    cost_usd: numeric('cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    unknown_cost_runs: integer('unknown_cost_runs').notNull().default(0),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_usage_daily_id', columns: [table.id] }),
    unique('uk_bot_usage_daily').on(table.team_id, table.bot_id, table.usage_date),
    check(
      'ck_bot_usage_daily_counts',
      sql`${table.input_tokens} >= 0 and ${table.output_tokens} >= 0 and ${table.cache_read_tokens} >= 0 and ${table.cache_write_tokens} >= 0 and ${table.cost_usd} >= 0 and ${table.unknown_cost_runs} >= 0`,
    ),
  ],
)

/** Bot 定时记忆整理的位置和上次运行结果。 */
export const botMemoryCursor = appSchema.table(
  'bot_memory_cursor',
  {
    ...teamAuditColumns(),
    bot_id: uuid('bot_id').notNull(),
    processed_until: timestamp('processed_until', { withTimezone: true, mode: 'date' }).notNull(),
    last_run_id: uuid('last_run_id'),
    last_result: text('last_result'),
  },
  (table) => [
    primaryKey({ name: 'pk_bot_memory_cursor_id', columns: [table.id] }),
    unique('uk_bot_memory_cursor_bot').on(table.bot_id),
    check(
      'ck_bot_memory_cursor_result',
      sql`${table.last_result} in ('applied', 'no_change', 'skipped_budget', 'skipped_model', 'failed')`,
    ),
  ],
)
