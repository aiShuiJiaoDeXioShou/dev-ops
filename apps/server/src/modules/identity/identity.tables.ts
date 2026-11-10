import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

// Better Auth 表：Drizzle 属性名与数据库列名均使用 snake_case，
// 通过 identity.auth.ts 的 fields 映射匹配 Better Auth 的 camelCase 模型字段。
// 不建立数据库外键；账号、会话与团队成员的一致性由业务事务和测试保证。

/** Better Auth 用户账号。 */
export const authUser = appSchema.table(
  'user',
  {
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    email_verified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: 'pk_user_id', columns: [table.id] }), unique('uk_user_email').on(table.email)],
)

/** Better Auth 数据库会话。 */
export const authSession = appSchema.table(
  'session',
  {
    id: uuid('id').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    user_id: uuid('user_id').notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_session_id', columns: [table.id] }),
    unique('uk_session_token').on(table.token),
    index('idx_session_user_id').on(table.user_id),
  ],
)

/** Better Auth 邮箱密码凭据及其他可选账号凭据。 */
export const authAccount = appSchema.table(
  'account',
  {
    id: uuid('id').notNull(),
    account_id: text('account_id').notNull(),
    provider_id: text('provider_id').notNull(),
    user_id: uuid('user_id').notNull(),
    access_token: text('access_token'),
    refresh_token: text('refresh_token'),
    id_token: text('id_token'),
    access_token_expires_at: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
    refresh_token_expires_at: timestamp('refresh_token_expires_at', { withTimezone: true, mode: 'date' }),
    scope: text('scope'),
    password: text('password'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_account_id', columns: [table.id] }),
    unique('uk_account_provider_account').on(table.provider_id, table.account_id),
    index('idx_account_user_id').on(table.user_id),
  ],
)

/** Better Auth 邮件验证、密码重置等一次性令牌。 */
export const authVerification = appSchema.table(
  'verification',
  {
    id: uuid('id').notNull(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_verification_id', columns: [table.id] }),
    index('idx_verification_identifier').on(table.identifier),
  ],
)

/** 平台级 root 账号；与团队角色分开管理。 */
export const platformAdmin = appSchema.table(
  'platform_admin',
  {
    user_id: uuid('user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: 'pk_platform_admin_user_id', columns: [table.user_id] })],
)

/** 内部团队；团队是业务数据的归属单位。 */
export const team = appSchema.table(
  'team',
  {
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    icon_text: text('icon_text'),
    description: text('description'),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: 'pk_team_id', columns: [table.id] }), unique('uk_team_name').on(table.name)],
)

/** 团队成员及团队角色；角色与平台 root 身份分开。 */
export const teamMember = appSchema.table(
  'team_member',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    user_id: uuid('user_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull(),
    joined_at: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_team_member_id', columns: [table.id] }),
    unique('uk_team_member').on(table.team_id, table.user_id),
    check('ck_team_member_role', sql`${table.role} in ('admin', 'developer', 'viewer')`),
    check('ck_team_member_status', sql`${table.status} in ('active', 'disabled')`),
    index('idx_team_member_user_id').on(table.user_id),
    index('idx_team_member_team_status').on(table.team_id, table.status),
  ],
)

/** 团队邀请；只保存 token 哈希，不保存明文邀请链接。 */
export const invitation = appSchema.table(
  'invitation',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    token_hash: text('token_hash').notNull(),
    status: text('status').notNull(),
    invited_by_user_id: uuid('invited_by_user_id').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    accepted_at: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    delivery_status: text('delivery_status').notNull().default('pending'),
    send_attempts: integer('send_attempts').notNull().default(0),
    last_sent_at: timestamp('last_sent_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_invitation_id', columns: [table.id] }),
    unique('uk_invitation_token_hash').on(table.token_hash),
    check('ck_invitation_role', sql`${table.role} in ('admin', 'developer', 'viewer')`),
    check('ck_invitation_status', sql`${table.status} in ('pending', 'accepted', 'expired', 'revoked')`),
    check('ck_invitation_delivery_status', sql`${table.delivery_status} in ('pending', 'sent', 'failed')`),
    uniqueIndex('uk_invitation_pending_email')
      .on(table.team_id, table.email)
      .where(sql`${table.status} = 'pending'`),
    index('idx_invitation_team_status').on(table.team_id, table.status),
    index('idx_invitation_expires_at').on(table.expires_at),
  ],
)

/** 个人 API Token；仅保存摘要，明文只在创建响应出现一次。 */
export const personalAccessToken = appSchema.table(
  'personal_access_token',
  {
    id: uuid('id').notNull(),
    user_id: uuid('user_id').notNull(),
    name: text('name').notNull(),
    token_hash: text('token_hash').notNull(),
    token_prefix: text('token_prefix').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    last_used_at: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_personal_access_token_id', columns: [table.id] }),
    unique('uk_personal_access_token_hash').on(table.token_hash),
    unique('uk_personal_access_token_user_name').on(table.user_id, table.name),
    index('idx_personal_access_token_user_id').on(table.user_id),
    index('idx_personal_access_token_expires_at').on(table.expires_at),
  ],
)
