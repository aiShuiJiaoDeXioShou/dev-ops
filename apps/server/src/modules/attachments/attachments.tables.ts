import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/**
 * 业务附件记录。
 * @remarks 状态 temp 为上传后未绑定；bound 为已绑定业务记录；removed 为待删除对象（对象删除在事务提交后执行）。
 */
export const attachment = appSchema.table(
  'attachment',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    bucket_id: uuid('bucket_id').notNull(),
    storage_key: text('storage_key').notNull(),
    file_name: text('file_name').notNull(),
    size_bytes: integer('size_bytes').notNull(),
    content_type: text('content_type'),
    sha256: text('sha256').notNull(),
    status: text('status').notNull().default('temp'),
    target_type: text('target_type'),
    target_id: uuid('target_id'),
    uploaded_by_user_id: uuid('uploaded_by_user_id').notNull(),
    bound_at: timestamp('bound_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_attachment_id', columns: [table.id] }),
    unique('uk_attachment_storage_key').on(table.bucket_id, table.storage_key),
    check('ck_attachment_status', sql`${table.status} in ('temp', 'bound', 'removed')`),
    check('ck_attachment_size', sql`${table.size_bytes} > 0`),
    check(
      'ck_attachment_target',
      sql`(
    (${table.status} = 'temp' AND ${table.target_type} IS NULL AND ${table.target_id} IS NULL
      AND ${table.bound_at} IS NULL)
    OR (${table.status} in ('bound', 'removed') AND ${table.target_type} in ('requirement', 'bug')
      AND ${table.target_id} IS NOT NULL AND ${table.bound_at} IS NOT NULL)
  )`,
    ),
    index('idx_attachment_target')
      .on(table.target_type, table.target_id, table.created_at, table.id)
      .where(sql`${table.status} = 'bound'`),
    index('idx_attachment_bucket').on(table.bucket_id),
    index('idx_attachment_temp')
      .on(table.created_at)
      .where(sql`${table.status} = 'temp'`),
    index('idx_attachment_removed')
      .on(table.updated_at)
      .where(sql`${table.status} = 'removed'`),
    index('idx_attachment_project').on(table.project_id, table.created_at, table.id),
  ],
)

/** 附件目标类型；与契约取值保持一致。 */
export type AttachmentTargetType = 'requirement' | 'bug'

/** 附件状态；由服务端状态机维护。 */
export type AttachmentStatus = 'temp' | 'bound' | 'removed'
