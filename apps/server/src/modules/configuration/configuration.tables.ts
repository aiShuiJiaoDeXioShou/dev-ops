import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 加密保存的 Git 凭据；业务接口只返回名称、状态与版本。 */
export const secret = appSchema.table(
  'secret',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    auth_tag: text('auth_tag').notNull(),
    key_version: smallint('key_version').notNull(),
    status: text('status').notNull().default('active'),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    rotated_from_id: uuid('rotated_from_id'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_secret_id', columns: [table.id] }),
    check('ck_secret_kind', sql`${table.kind} in ('git_token', 'github_app_private_key')`),
    check('ck_secret_status', sql`${table.status} in ('active', 'revoked')`),
    index('idx_secret_team_kind').on(table.team_id, table.kind, table.status),
  ],
)

/**
 * 团队凭据库条目：只保存名称、分类、说明与状态等元数据，密文按版本存入 credential_version。
 * 名称在团队内唯一；撤销只改状态并保留历史，不硬删除。
 */
export const credential = appSchema.table(
  'credential',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    current_version: integer('current_version').notNull().default(1),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_credential_id', columns: [table.id] }),
    unique('uk_credential_team_name').on(table.team_id, table.name),
    check('ck_credential_kind', sql`${table.kind} in ('api_key', 'account_password', 'ssh_key')`),
    check('ck_credential_status', sql`${table.status} in ('active', 'revoked')`),
    check('ck_credential_current_version', sql`${table.current_version} >= 1`),
    check('ck_credential_name_length', sql`char_length(${table.name}) between 1 and 120`),
    index('idx_credential_team_status').on(table.team_id, table.status, table.updated_at),
  ],
)

/**
 * 凭据每个版本的密文；旧版本只用于审计与使用记录追溯，不再被新引用使用。
 * 轮换保持凭据标识不变并递增版本，依赖引用无需重新配置。
 */
export const credentialVersion = appSchema.table(
  'credential_version',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    credential_id: uuid('credential_id').notNull(),
    version: integer('version').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    auth_tag: text('auth_tag').notNull(),
    key_version: smallint('key_version').notNull(),
    rotated_from_version: integer('rotated_from_version'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_credential_version_id', columns: [table.id] }),
    unique('uk_credential_version').on(table.credential_id, table.version),
    check('ck_credential_version_positive', sql`${table.version} >= 1`),
    index('idx_credential_version_credential').on(table.credential_id, table.created_at),
  ],
)

/**
 * 凭据对项目的授权与期限；撤销后排他更新 revoked_at 并保留行，恢复授权复用该行。
 * 授权只允许同团队项目，不得扩大团队原有授权。
 */
export const credentialProjectGrant = appSchema.table(
  'credential_project_grant',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    credential_id: uuid('credential_id').notNull(),
    project_id: uuid('project_id').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    granted_by_user_id: uuid('granted_by_user_id').notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_credential_project_grant_id', columns: [table.id] }),
    unique('uk_credential_project_grant').on(table.credential_id, table.project_id),
    index('idx_credential_project_grant_project').on(table.project_id, table.revoked_at),
  ],
)

/**
 * 项目环境变量：按开发/测试/生产隔离，同项目同环境内名称唯一。
 * plain 保存普通值；credential_ref 只保存凭据标识与版本引用，不复制密钥值。
 */
export const projectEnvVar = appSchema.table(
  'project_env_var',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    environment: text('environment').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    value_text: text('value_text'),
    credential_id: uuid('credential_id'),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_env_var_id', columns: [table.id] }),
    unique('uk_project_env_var').on(table.project_id, table.environment, table.name),
    check('ck_project_env_var_environment', sql`${table.environment} in ('development', 'test', 'production')`),
    check('ck_project_env_var_kind', sql`${table.kind} in ('plain', 'credential_ref')`),
    check('ck_project_env_var_status', sql`${table.status} in ('active', 'invalid')`),
    check(
      'ck_project_env_var_ref',
      sql`(${table.kind} = 'credential_ref' and ${table.credential_id} is not null and ${table.value_text} is null) or (${table.kind} = 'plain' and ${table.credential_id} is null and ${table.value_text} is not null)`,
    ),
    check('ck_project_env_var_name_length', sql`char_length(${table.name}) between 1 and 120`),
    check('ck_project_env_var_version', sql`${table.version} >= 1`),
    index('idx_project_env_var_project_env').on(table.project_id, table.environment, table.name),
  ],
)

/**
 * 凭据使用与管理动作审计；只记录引用、版本与结果，不含密钥值或来源请求体。
 * 历史使用记录在凭据撤销、过期后仍保留。
 */
export const credentialUsage = appSchema.table(
  'credential_usage',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    credential_id: uuid('credential_id').notNull(),
    credential_version: integer('credential_version').notNull(),
    project_id: uuid('project_id'),
    environment: text('environment'),
    action: text('action').notNull(),
    actor_user_id: uuid('actor_user_id'),
    result: text('result').notNull(),
    error_code: text('error_code'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_credential_usage_id', columns: [table.id] }),
    check(
      'ck_credential_usage_action',
      sql`${table.action} in ('use', 'create', 'rotate', 'revoke', 'grant', 'revoke_grant', 'read_metadata', 'reveal')`,
    ),
    check('ck_credential_usage_result', sql`${table.result} in ('success', 'denied', 'expired', 'failed')`),
    check(
      'ck_credential_usage_environment',
      sql`${table.environment} is null or ${table.environment} in ('development', 'test', 'production')`,
    ),
    index('idx_credential_usage_credential').on(table.credential_id, table.created_at),
    index('idx_credential_usage_team').on(table.team_id, table.created_at),
    // 明文查看按用户限流，按操作者、动作与时间统计最近尝试次数。
    index('idx_credential_usage_actor_action').on(table.actor_user_id, table.action, table.created_at),
  ],
)
