import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from '../../platform/database/namespace.ts'

/** 构建/交付上报主记录；来源事实与业务追溯分开。 */
export const buildRecord = appSchema.table(
  'build_record',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id'),
    environment: text('environment'),
    build_key: text('build_key').notNull(),
    version_label: text('version_label').notNull(),
    commit_ref: text('commit_ref'),
    source: text('source').notNull(),
    source_run_id: text('source_run_id'),
    collected_at: timestamp('collected_at', { withTimezone: true, mode: 'date' }).notNull(),
    result_status: text('result_status').notNull(),
    note: text('note'),
    version: integer('version').notNull().default(1),
    reported_by_user_id: uuid('reported_by_user_id').notNull(),
    reporter_kind: text('reporter_kind').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_build_record_id', columns: [table.id] }),
    unique('uk_build_record_identity').on(table.project_id, table.source, table.build_key),
    check(
      'ck_build_record_environment',
      sql`${table.environment} is null or ${table.environment} in ('development', 'test', 'production')`,
    ),
    check('ck_build_record_status', sql`${table.result_status} in ('succeeded', 'failed', 'cancelled', 'unknown')`),
    check('ck_build_record_source', sql`${table.source} in ('pipeline', 'local', 'external_system', 'manual')`),
    check('ck_build_record_reporter', sql`${table.reporter_kind} in ('web', 'api_token', 'cli')`),
    index('idx_build_record_project_time').on(table.project_id, table.collected_at, table.id),
    index('idx_build_record_service_time').on(table.service_id, table.collected_at),
  ],
)

/** 构建记录更正历史；只增不改，保留原值快照。 */
export const buildRecordCorrection = appSchema.table(
  'build_record_correction',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    build_id: uuid('build_id').notNull(),
    previous_snapshot: jsonb('previous_snapshot').$type<Record<string, unknown>>().notNull(),
    corrected_fields: jsonb('corrected_fields').$type<Record<string, unknown>>().notNull(),
    reason: text('reason').notNull(),
    corrected_by_user_id: uuid('corrected_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_build_record_correction_id', columns: [table.id] }),
    index('idx_build_record_correction_build').on(table.build_id, table.created_at),
  ],
)

/** 构建产物引用；平台只保存访问引用，不托管文件。 */
export const buildArtifact = appSchema.table(
  'build_artifact',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    build_id: uuid('build_id').notNull(),
    artifact_type: text('artifact_type').notNull(),
    version_label: text('version_label').notNull(),
    access_url: text('access_url').notNull(),
    source: text('source').notNull(),
    collected_at: timestamp('collected_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: text('status').notNull().default('available'),
    note: text('note'),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_build_artifact_id', columns: [table.id] }),
    check(
      'ck_build_artifact_type',
      sql`${table.artifact_type} in ('mobile_package', 'mini_program_qr', 'web_test_url')`,
    ),
    check('ck_build_artifact_status', sql`${table.status} in ('available', 'expired', 'invalid')`),
    check('ck_build_artifact_source', sql`${table.source} in ('manual', 'pipeline', 'external_system')`),
    index('idx_build_artifact_build').on(table.build_id, table.created_at),
    index('idx_build_artifact_project_type').on(table.project_id, table.artifact_type, table.collected_at),
  ],
)

/** 构建记录与需求/Bug 的可选追溯关联；不进入提测、不作为提测条件。 */
export const buildRecordTarget = appSchema.table(
  'build_record_target',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    build_id: uuid('build_id').notNull(),
    target_type: text('target_type').notNull(),
    target_id: uuid('target_id').notNull(),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_build_record_target_id', columns: [table.id] }),
    unique('uk_build_record_target').on(table.build_id, table.target_type, table.target_id),
    check('ck_build_record_target_type', sql`${table.target_type} in ('requirement', 'bug')`),
    index('idx_build_record_target_target').on(table.target_type, table.target_id),
  ],
)

/** 服务在某环境的当前运行版本；每服务每环境一行，新构建与产物不自动写入。 */
export const serviceRunVersion = appSchema.table(
  'service_run_version',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id').notNull(),
    environment: text('environment').notNull(),
    version_label: text('version_label'),
    source: text('source').notNull(),
    evidence_url: text('evidence_url'),
    verification_status: text('verification_status').notNull(),
    version: integer('version').notNull().default(1),
    confirmed_by_user_id: uuid('confirmed_by_user_id'),
    confirmed_at: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_service_run_version_id', columns: [table.id] }),
    unique('uk_service_run_version').on(table.service_id, table.environment),
    check('ck_service_run_version_env', sql`${table.environment} in ('development', 'test', 'production')`),
    check('ck_service_run_version_status', sql`${table.verification_status} in ('confirmed', 'pending', 'unknown')`),
    check('ck_service_run_version_source', sql`${table.source} in ('manual', 'deployment_receipt')`),
  ],
)

/** 运行版本变化历史；只增不改，保留确认/更正前后的值。 */
export const serviceRunVersionChange = appSchema.table(
  'service_run_version_change',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id').notNull(),
    environment: text('environment').notNull(),
    previous_version_label: text('previous_version_label'),
    new_version_label: text('new_version_label'),
    previous_status: text('previous_status').notNull(),
    new_status: text('new_status').notNull(),
    source: text('source').notNull(),
    evidence_url: text('evidence_url'),
    reason: text('reason'),
    changed_by_user_id: uuid('changed_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_service_run_version_change_id', columns: [table.id] }),
    index('idx_service_run_version_change_service').on(table.service_id, table.environment, table.created_at),
    check('ck_service_run_version_change_env', sql`${table.environment} in ('development', 'test', 'production')`),
    check(
      'ck_service_run_version_change_prev_status',
      sql`${table.previous_status} in ('confirmed', 'pending', 'unknown')`,
    ),
    check('ck_service_run_version_change_new_status', sql`${table.new_status} in ('confirmed', 'pending', 'unknown')`),
  ],
)

/** 外部流水线一次运行；按项目＋来源＋来源运行标识幂等。 */
export const pipelineRun = appSchema.table(
  'pipeline_run',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id'),
    pipeline_name: text('pipeline_name').notNull(),
    pipeline_key: text('pipeline_key').notNull(),
    commit_ref: text('commit_ref'),
    trigger_source: text('trigger_source').notNull(),
    status: text('status').notNull(),
    started_at: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    result_url: text('result_url'),
    source: text('source').notNull(),
    source_run_id: text('source_run_id').notNull(),
    last_reported_at: timestamp('last_reported_at', { withTimezone: true, mode: 'date' }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_run_id', columns: [table.id] }),
    unique('uk_pipeline_run_identity').on(table.project_id, table.source, table.source_run_id),
    check(
      'ck_pipeline_run_status',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')`,
    ),
    check(
      'ck_pipeline_run_trigger',
      sql`${table.trigger_source} in ('manual', 'push', 'schedule', 'external', 'unknown')`,
    ),
    index('idx_pipeline_run_project_time').on(table.project_id, table.started_at),
  ],
)

/** 流水线运行状态历史；只增不改，记录每次实际生效的上报。 */
export const pipelineRunStatus = appSchema.table(
  'pipeline_run_status',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    pipeline_run_id: uuid('pipeline_run_id').notNull(),
    status: text('status').notNull(),
    reported_at: timestamp('reported_at', { withTimezone: true, mode: 'date' }).notNull(),
    note: text('note'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_pipeline_run_status_id', columns: [table.id] }),
    index('idx_pipeline_run_status_run').on(table.pipeline_run_id, table.reported_at, table.id),
    check(
      'ck_pipeline_run_status_value',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')`,
    ),
  ],
)

/** 外部提审一次记录；重新提审新增记录，不覆盖旧记录。 */
export const externalReview = appSchema.table(
  'external_review',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    service_id: uuid('service_id'),
    target_type: text('target_type').notNull(),
    version_label: text('version_label').notNull(),
    review_platform: text('review_platform').notNull(),
    submitted_at: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).notNull(),
    submitted_by_user_id: uuid('submitted_by_user_id').notNull(),
    note: text('note'),
    evidence_url: text('evidence_url'),
    review_status: text('review_status').notNull(),
    review_reason: text('review_reason'),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    version: integer('version').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_external_review_id', columns: [table.id] }),
    check('ck_external_review_target', sql`${table.target_type} in ('mini_program', 'mobile_app')`),
    check(
      'ck_external_review_status',
      sql`${table.review_status} in ('pending', 'approved', 'rejected', 'withdrawn', 'unknown')`,
    ),
    index('idx_external_review_project_time').on(table.project_id, table.submitted_at),
  ],
)

/** 实际发布结果；与审核记录分离，审核通过不自动生成。 */
export const releaseResult = appSchema.table(
  'release_result',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id').notNull(),
    project_id: uuid('project_id').notNull(),
    review_id: uuid('review_id'),
    service_id: uuid('service_id'),
    version_label: text('version_label').notNull(),
    release_status: text('release_status').notNull(),
    released_at: timestamp('released_at', { withTimezone: true, mode: 'date' }),
    scope_note: text('scope_note'),
    evidence_url: text('evidence_url'),
    version: integer('version').notNull().default(1),
    recorded_by_user_id: uuid('recorded_by_user_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_release_result_id', columns: [table.id] }),
    check(
      'ck_release_result_status',
      sql`${table.release_status} in ('not_released', 'released', 'partially_released', 'unknown')`,
    ),
    index('idx_release_result_project_time').on(table.project_id, table.released_at),
  ],
)
