import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, primaryKey, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/**
 * 团队技能：技能当前元数据，正文保存在 `skill_version`。
 *
 * `identifier` 是对话与 Bot 配置使用的稳定调用标识，发布后不可修改；
 * `version` 是乐观锁修订号，与内容版本 `skill_version.content_version` 分开维护。
 */
export const skill = appSchema.table(
  'skill',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    name: varchar('name', { length: 30 }).notNull(),
    identifier: varchar('identifier', { length: 40 }).notNull(),
    category: varchar('category', { length: 16 }).notNull(),
    summary: varchar('summary', { length: 100 }).notNull(),
    source: varchar('source', { length: 16 }).notNull().default('team'),
    enabled: boolean('enabled').notNull().default(true),
    current_version_id: uuid('current_version_id').notNull(),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_skill_id', columns: [table.id] }),
    unique('uk_skill_team_identifier').on(table.team_id, table.identifier),
    check('ck_skill_category', sql`${table.category} in ('product', 'engineering', 'delivery')`),
    check('ck_skill_source', sql`${table.source} in ('team')`),
    check('ck_skill_identifier_format', sql`${table.identifier} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    index('idx_skill_team_updated').on(table.team_id, table.updated_at, table.id),
    index('idx_skill_team_category').on(table.team_id, table.category),
  ],
)

/**
 * 技能内容版本：指令正文全量快照，只追加不修改、不删除。
 *
 * 同一技能的 `content_version` 唯一；修改指令内容必须使用不同的版本号。
 */
export const skillVersion = appSchema.table(
  'skill_version',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    skill_id: uuid('skill_id').notNull(),
    content_version: varchar('content_version', { length: 20 }).notNull(),
    content: varchar('content', { length: 6000 }).notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_skill_version_id', columns: [table.id] }),
    unique('uk_skill_version_skill_content_version').on(table.skill_id, table.content_version),
    check('ck_skill_version_format', sql`${table.content_version} ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'`),
    index('idx_skill_version_skill_created').on(table.skill_id, table.created_at, table.id),
  ],
)

/**
 * AGENTS.md 模板：当前元数据，正文保存在 `agent_template_version`。
 *
 * `name_normalized` 保存去首尾空白并转小写后的名称，用于团队内大小写不敏感唯一；
 * `version` 是乐观锁修订号，内容版本由 `agent_template_version.version` 表达。
 */
export const agentTemplate = appSchema.table(
  'agent_template',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    name: varchar('name', { length: 40 }).notNull(),
    name_normalized: varchar('name_normalized', { length: 40 }).notNull(),
    tag: varchar('tag', { length: 30 }).notNull(),
    description: varchar('description', { length: 200 }),
    current_version_id: uuid('current_version_id').notNull(),
    version: integer('version').notNull().default(1),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_agent_template_id', columns: [table.id] }),
    unique('uk_agent_template_team_normalized_name').on(table.team_id, table.name_normalized),
    index('idx_agent_template_team_updated').on(table.team_id, table.updated_at, table.id),
    index('idx_agent_template_team_tag').on(table.team_id, table.tag),
  ],
)

/**
 * 模板正文版本：按保存次数整数递增；内容全量快照，只追加不修改、不删除。
 */
export const agentTemplateVersion = appSchema.table(
  'agent_template_version',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    template_id: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    content: varchar('content', { length: 20000 }).notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_agent_template_version_id', columns: [table.id] }),
    unique('uk_agent_template_version_template_version').on(table.template_id, table.version),
    check('ck_agent_template_version_positive', sql`${table.version} >= 1`),
    index('idx_agent_template_version_template_version').on(table.template_id, table.version),
  ],
)

/**
 * 项目当前选用的 AGENTS.md 模板；一个项目最多一行当前选用。
 *
 * 选用、切换、取消的历史记录在 `collaboration.activity`，不在本表保存历史行。
 */
export const projectTemplateSelection = appSchema.table(
  'project_template_selection',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    template_id: uuid('template_id').notNull(),
    selected_by_user_id: uuid('selected_by_user_id').notNull(),
    version: integer('version').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_project_template_selection_id', columns: [table.id] }),
    unique('uk_project_template_selection_project').on(table.project_id),
    index('idx_project_template_selection_team').on(table.team_id),
    index('idx_project_template_selection_template').on(table.template_id),
  ],
)

/**
 * 模板快照预览链接：绑定某个模板内容版本。
 *
 * 令牌是定位符而非凭证，打开链接仍须登录并校验团队成员关系；
 * V0.3 不设自动过期、不提供匿名访问与撤回。
 */
export const templateSnapshotLink = appSchema.table(
  'template_snapshot_link',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    template_id: uuid('template_id').notNull(),
    template_version_id: uuid('template_version_id').notNull(),
    token: varchar('token', { length: 64 }).notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_template_snapshot_link_id', columns: [table.id] }),
    unique('uk_template_snapshot_link_token').on(table.token),
    index('idx_template_snapshot_link_template').on(table.template_id, table.created_at, table.id),
  ],
)
