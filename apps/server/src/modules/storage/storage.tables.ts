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
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 内置本地储存桶的固定标识；迁移种子与启动校验共用。 */
export const BUILTIN_LOCAL_BUCKET_ID = '00000000-0000-4000-8000-000000000001'

/** 系统占位操作者；迁移种子不依赖 root 用户先存在。 */
export const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000'

/**
 * 平台级储存桶配置。
 * @remarks 内置本地桶始终存在且为初始默认；自定义桶为 S3 兼容协议，凭据只存密文。
 */
export const storageBucket = appSchema.table(
  'storage_bucket',
  {
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    is_builtin: boolean('is_builtin').notNull().default(false),
    is_default: boolean('is_default').notNull().default(false),
    status: text('status').notNull().default('enabled'),
    endpoint: text('endpoint'),
    bucket_name: text('bucket_name'),
    region: text('region'),
    path_prefix: text('path_prefix'),
    access_key_hint: text('access_key_hint'),
    credential_ciphertext: text('credential_ciphertext'),
    credential_iv: text('credential_iv'),
    credential_auth_tag: text('credential_auth_tag'),
    credential_key_version: integer('credential_key_version'),
    last_probe_result: text('last_probe_result'),
    last_probe_message: text('last_probe_message'),
    last_probed_at: timestamp('last_probed_at', { withTimezone: true, mode: 'date' }),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    version: integer('version').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_storage_bucket_id', columns: [table.id] }),
    unique('uk_storage_bucket_name').on(table.name),
    // 单默认桶：仅对 is_default = true 的行建立唯一索引
    uniqueIndex('uk_storage_bucket_default')
      .on(table.is_default)
      .where(sql`${table.is_default}`),
    check('ck_storage_bucket_kind', sql`${table.kind} in ('local', 's3')`),
    check('ck_storage_bucket_status', sql`${table.status} in ('enabled', 'disabled')`),
    check(
      'ck_storage_bucket_probe',
      sql`${table.last_probe_result} is null or ${table.last_probe_result} in ('read_write', 'read_only', 'unreachable', 'auth_failed')`,
    ),
    check(
      'ck_storage_bucket_s3_fields',
      sql`(
    (${table.kind} = 's3' AND ${table.endpoint} IS NOT NULL AND ${table.bucket_name} IS NOT NULL
      AND ${table.region} IS NOT NULL AND ${table.credential_ciphertext} IS NOT NULL
      AND ${table.credential_iv} IS NOT NULL AND ${table.credential_auth_tag} IS NOT NULL
      AND ${table.credential_key_version} IS NOT NULL AND ${table.is_builtin} = false)
    OR (${table.kind} = 'local' AND ${table.is_builtin} = true AND ${table.endpoint} IS NULL
      AND ${table.bucket_name} IS NULL AND ${table.region} IS NULL AND ${table.path_prefix} IS NULL
      AND ${table.access_key_hint} IS NULL AND ${table.credential_ciphertext} IS NULL
      AND ${table.credential_iv} IS NULL AND ${table.credential_auth_tag} IS NULL
      AND ${table.credential_key_version} IS NULL)
  )`,
    ),
    index('idx_storage_bucket_status').on(table.status, table.created_at, table.id),
  ],
)

/** 储存桶配置变更审计；平台级事件不进入团队活动流。 */
export const storageBucketEvent = appSchema.table(
  'storage_bucket_event',
  {
    id: uuid('id').notNull(),
    bucket_id: uuid('bucket_id').notNull(),
    action: text('action').notNull(),
    actor_user_id: uuid('actor_user_id').notNull(),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_storage_bucket_event_id', columns: [table.id] }),
    check(
      'ck_storage_bucket_event_action',
      sql`${table.action} in ('bucket_created', 'bucket_updated', 'bucket_probed', 'bucket_set_default', 'bucket_removed')`,
    ),
    index('idx_storage_bucket_event_bucket').on(table.bucket_id, table.created_at, table.id),
  ],
)
