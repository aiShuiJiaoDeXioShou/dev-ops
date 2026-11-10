import type { ProjectArtifactRecord } from './delivery.artifact.repository.ts'
import type { RelatedBuildRecord } from './delivery.pipeline.repository.ts'
import {
  externalReview,
  pipelineRun,
  pipelineRunStatus,
  releaseResult,
  serviceRunVersion,
  serviceRunVersionChange,
} from './delivery.tables.ts'
import type {
  ArtifactSource,
  ArtifactStatus,
  ArtifactType,
  BuildResultStatus,
  Environment,
  PipelineStatus,
  PipelineTriggerSource,
  ReleaseStatus,
  ReviewStatus,
  ReviewTargetType,
  RunVersionSource,
  VerificationStatus,
} from './delivery.validators.ts'
import {
  toArtifactSource,
  toArtifactStatus,
  toArtifactType,
  toBuildResultStatus,
  toEnvironment,
  toExternalUrl,
  toPipelineStatus,
  toPipelineTriggerSource,
  toReleaseStatus,
  toReviewStatus,
  toReviewTargetType,
  toRunVersionSource,
  toVerificationStatus,
} from './delivery.validators.ts'

/** 列表视图的统一分页结构。 */
export interface PageView<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

/**
 * 将时间转换为 UTC ISO 字符串。
 * @param value 数据库时间或空值。
 * @returns ISO 字符串或 null。
 */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/**
 * 构造统一分页视图。
 * @param items 当前页数据。
 * @param page 页码。
 * @param pageSize 页大小。
 * @param total 总数。
 * @returns 分页视图。
 */
export function pageView<T>(items: T[], page: number, pageSize: number, total: number): PageView<T> {
  return { items, page, pageSize, total }
}

/** 项目产物视图；在构建记录产物视图上补充归属与最新标记。 */
export interface ProjectArtifactView {
  id: string
  buildId: string
  serviceId: string | null
  environment: Environment | null
  artifactType: ArtifactType
  versionLabel: string
  accessUrl: string
  source: ArtifactSource
  collectedAt: string
  status: ArtifactStatus
  note: string | null
  isLatest: boolean
}

/** 服务运行版本视图；尚无记录时 version 为 0、updatedAt 为 null，不得显示为最新构建。 */
export interface RunVersionView {
  serviceId: string
  environment: Environment
  versionLabel: string | null
  source: RunVersionSource | null
  evidenceUrl: string | null
  verificationStatus: VerificationStatus
  confirmedBy: string | null
  confirmedAt: string | null
  version: number
  updatedAt: string | null
}

/** 运行版本变化历史视图。 */
export interface RunVersionChangeView {
  id: string
  previousVersionLabel: string | null
  newVersionLabel: string | null
  previousStatus: VerificationStatus
  newStatus: VerificationStatus
  source: RunVersionSource
  evidenceUrl: string | null
  reason: string | null
  changedBy: string
  changedAt: string
}

/** 流水线运行视图。 */
export interface PipelineRunView {
  id: string
  projectId: string
  serviceId: string | null
  pipelineName: string
  pipelineKey: string
  commitRef: string | null
  triggerSource: PipelineTriggerSource
  status: PipelineStatus
  startedAt: string | null
  finishedAt: string | null
  resultUrl: string | null
  source: string
  sourceRunId: string
  lastReportedAt: string
  createdAt: string
  updatedAt: string
}

/** 流水线运行状态历史视图。 */
export interface PipelineRunStatusView {
  id: string
  status: PipelineStatus
  reportedAt: string
  note: string | null
  createdAt: string
}

/** 运行详情按来源运行标识关联的构建摘要。 */
export interface RelatedBuildView {
  id: string
  versionLabel: string
  collectedAt: string
  resultStatus: BuildResultStatus
}

/** 流水线运行详情视图：运行字段加状态历史与关联构建。 */
export interface PipelineRunDetailView extends PipelineRunView {
  statusHistory: PipelineRunStatusView[]
  relatedBuilds: RelatedBuildView[]
}

/** 外部提审记录视图。 */
export interface ReviewView {
  id: string
  projectId: string
  serviceId: string | null
  targetType: ReviewTargetType
  versionLabel: string
  reviewPlatform: string
  submittedAt: string
  submittedBy: string
  note: string | null
  evidenceUrl: string | null
  reviewStatus: ReviewStatus
  reviewReason: string | null
  reviewedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

/** 实际发布结果视图；与审核结果分别表达。 */
export interface ReleaseView {
  id: string
  projectId: string
  reviewId: string | null
  serviceId: string | null
  versionLabel: string
  releaseStatus: ReleaseStatus
  releasedAt: string | null
  scopeNote: string | null
  evidenceUrl: string | null
  version: number
  recordedBy: string
  createdAt: string
  updatedAt: string
}

type RunVersionRow = typeof serviceRunVersion.$inferSelect
type RunVersionChangeRow = typeof serviceRunVersionChange.$inferSelect
type PipelineRunRow = typeof pipelineRun.$inferSelect
type PipelineRunStatusRow = typeof pipelineRunStatus.$inferSelect
type ExternalReviewRow = typeof externalReview.$inferSelect
type ReleaseResultRow = typeof releaseResult.$inferSelect

/**
 * 将项目产物行映射为视图，并在读取边界再次校验存量地址安全性。
 * @param row 产物联表行。
 * @returns 项目产物视图。
 * @throws 数据库存量地址或枚举不合法时抛出普通 Error。
 */
export function toProjectArtifactView(row: ProjectArtifactRecord): ProjectArtifactView {
  return {
    id: row.id,
    buildId: row.build_id,
    serviceId: row.service_id,
    environment: row.environment ? toEnvironment(row.environment) : null,
    artifactType: toArtifactType(row.artifact_type),
    versionLabel: row.version_label,
    accessUrl: toExternalUrl(row.access_url, '产物地址'),
    source: toArtifactSource(row.source),
    collectedAt: toIso(row.collected_at) ?? '',
    status: toArtifactStatus(row.status),
    note: row.note,
    isLatest: row.is_latest,
  }
}

/**
 * 将运行版本行映射为视图。
 * @param row 运行版本行。
 * @returns 运行版本视图。
 * @throws 数据库枚举不合法时抛出普通 Error。
 */
export function toRunVersionView(row: RunVersionRow): RunVersionView {
  return {
    serviceId: row.service_id,
    environment: toEnvironment(row.environment),
    versionLabel: row.version_label,
    source: toRunVersionSource(row.source),
    evidenceUrl: row.evidence_url === null ? null : toExternalUrl(row.evidence_url, '证据地址'),
    verificationStatus: toVerificationStatus(row.verification_status),
    confirmedBy: row.confirmed_by_user_id,
    confirmedAt: toIso(row.confirmed_at),
    version: row.version,
    updatedAt: toIso(row.updated_at),
  }
}

/**
 * 构造尚无记录环境的运行版本视图，用于按预置环境展示「未知」。
 * @param serviceId 服务标识。
 * @param environment 预置环境。
 * @returns 版本号为 0、状态未知的运行版本视图。
 */
export function emptyRunVersionView(serviceId: string, environment: Environment): RunVersionView {
  return {
    serviceId,
    environment,
    versionLabel: null,
    source: null,
    evidenceUrl: null,
    verificationStatus: 'unknown',
    confirmedBy: null,
    confirmedAt: null,
    version: 0,
    updatedAt: null,
  }
}

/**
 * 将运行版本变化历史行映射为视图。
 * @param row 变化历史行。
 * @returns 变化历史视图。
 * @throws 数据库枚举不合法时抛出普通 Error。
 */
export function toRunVersionChangeView(row: RunVersionChangeRow): RunVersionChangeView {
  return {
    id: row.id,
    previousVersionLabel: row.previous_version_label,
    newVersionLabel: row.new_version_label,
    previousStatus: toVerificationStatus(row.previous_status),
    newStatus: toVerificationStatus(row.new_status),
    source: toRunVersionSource(row.source),
    evidenceUrl: row.evidence_url === null ? null : toExternalUrl(row.evidence_url, '证据地址'),
    reason: row.reason,
    changedBy: row.changed_by_user_id,
    changedAt: toIso(row.created_at) ?? '',
  }
}

/**
 * 将流水线运行行映射为视图。
 * @param row 流水线运行行。
 * @returns 流水线运行视图。
 * @throws 数据库枚举不合法时抛出普通 Error。
 */
export function toPipelineRunView(row: PipelineRunRow): PipelineRunView {
  return {
    id: row.id,
    projectId: row.project_id,
    serviceId: row.service_id,
    pipelineName: row.pipeline_name,
    pipelineKey: row.pipeline_key,
    commitRef: row.commit_ref,
    triggerSource: toPipelineTriggerSource(row.trigger_source),
    status: toPipelineStatus(row.status),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    resultUrl: row.result_url === null ? null : toExternalUrl(row.result_url, '结果地址'),
    source: row.source,
    sourceRunId: row.source_run_id,
    lastReportedAt: toIso(row.last_reported_at) ?? '',
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  }
}

/**
 * 将流水线状态历史行映射为视图。
 * @param row 状态历史行。
 * @returns 状态历史视图。
 * @throws 数据库状态不合法时抛出普通 Error。
 */
export function toPipelineRunStatusView(row: PipelineRunStatusRow): PipelineRunStatusView {
  return {
    id: row.id,
    status: toPipelineStatus(row.status),
    reportedAt: toIso(row.reported_at) ?? '',
    note: row.note,
    createdAt: toIso(row.created_at) ?? '',
  }
}

/**
 * 将关联构建行映射为摘要视图。
 * @param row 构建摘要行。
 * @returns 关联构建视图。
 * @throws 数据库状态不合法时抛出普通 Error。
 */
export function toRelatedBuildView(row: RelatedBuildRecord): RelatedBuildView {
  return {
    id: row.id,
    versionLabel: row.version_label,
    collectedAt: toIso(row.collected_at) ?? '',
    resultStatus: toBuildResultStatus(row.result_status),
  }
}

/**
 * 将外部提审行映射为视图。
 * @param row 提审行。
 * @returns 提审视图。
 * @throws 数据库枚举不合法时抛出普通 Error。
 */
export function toReviewView(row: ExternalReviewRow): ReviewView {
  return {
    id: row.id,
    projectId: row.project_id,
    serviceId: row.service_id,
    targetType: toReviewTargetType(row.target_type),
    versionLabel: row.version_label,
    reviewPlatform: row.review_platform,
    submittedAt: toIso(row.submitted_at) ?? '',
    submittedBy: row.submitted_by_user_id,
    note: row.note,
    evidenceUrl: row.evidence_url === null ? null : toExternalUrl(row.evidence_url, '证据地址'),
    reviewStatus: toReviewStatus(row.review_status),
    reviewReason: row.review_reason,
    reviewedAt: toIso(row.reviewed_at),
    version: row.version,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  }
}

/**
 * 将实际发布结果行映射为视图。
 * @param row 发布结果行。
 * @returns 发布结果视图。
 * @throws 数据库状态不合法时抛出普通 Error。
 */
export function toReleaseView(row: ReleaseResultRow): ReleaseView {
  return {
    id: row.id,
    projectId: row.project_id,
    reviewId: row.review_id,
    serviceId: row.service_id,
    versionLabel: row.version_label,
    releaseStatus: toReleaseStatus(row.release_status),
    releasedAt: toIso(row.released_at),
    scopeNote: row.scope_note,
    evidenceUrl: row.evidence_url === null ? null : toExternalUrl(row.evidence_url, '证据地址'),
    version: row.version,
    recordedBy: row.recorded_by_user_id,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  }
}
