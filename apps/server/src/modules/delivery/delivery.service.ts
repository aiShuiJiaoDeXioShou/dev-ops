import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { findBugSummaryById } from '../bugs/bugs.repository.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { findProjectServiceById } from '../projects/projects.repository.ts'
import { findRequirementSummaryById } from '../requirements/requirements.repository.ts'
import { createProjectAccess } from './delivery.access.ts'
import { createArtifactUseCases } from './delivery.artifact.service.ts'
import { isUniqueConstraintError } from './delivery.errors.ts'
import {
  deleteTarget,
  findBuildByBusinessKey,
  findBuildById,
  findBuilds,
  findTarget,
  insertArtifact,
  insertBuild,
  insertCorrection,
  insertTarget,
  listArtifactsForBuilds,
  listCorrections,
  listTargetsForBuilds,
  lockBuildForUpdate,
  updateBuildFields,
} from './delivery.repository.ts'
import type {
  ArtifactSource,
  ArtifactStatus,
  ArtifactType,
  BuildResultStatus,
  BuildSource,
  BuildTargetType,
  Environment,
} from './delivery.validators.ts'
import {
  optionalText,
  requireText,
  toArtifactStatus,
  toArtifactType,
  toBuildResultStatus,
  toEnvironment,
  validateAccessUrl,
  validateArtifactSource,
  validateArtifactType,
  validateBuildResultStatus,
  validateBuildSource,
  validateBuildTargetType,
  validateCollectedAt,
  validateEnvironment,
  validateReason,
} from './delivery.validators.ts'
import { createPipelineRunUseCases } from './delivery.pipeline.service.ts'
import { createReleaseUseCases } from './delivery.release.service.ts'
import { createReviewUseCases } from './delivery.review.service.ts'
import { createRunVersionUseCases } from './delivery.run-version.service.ts'
import { pageView, toIso, type PageView } from './delivery.view.ts'

/** 产物视图；只暴露引用与元数据，不代理文件。 */
export interface BuildArtifactView {
  id: string
  artifactType: ArtifactType
  versionLabel: string
  accessUrl: string
  source: ArtifactSource
  collectedAt: string
  status: ArtifactStatus
  note: string | null
}

/** 构建关联事项视图。 */
export interface BuildTargetView {
  id: string
  targetType: BuildTargetType
  targetId: string
  title: string
  number: number
}

/** 更正历史视图。 */
export interface BuildCorrectionView {
  id: string
  reason: string
  correctedByUserId: string
  correctedAt: string
}

/** 构建记录视图。 */
export interface BuildView {
  id: string
  projectId: string
  serviceId: string | null
  environment: Environment | null
  buildKey: string
  versionLabel: string
  commitRef: string | null
  source: BuildSource
  sourceRunId: string | null
  collectedAt: string
  resultStatus: BuildResultStatus
  note: string | null
  artifacts: BuildArtifactView[]
  targets: BuildTargetView[]
  corrections: BuildCorrectionView[]
  version: number
  createdAt: string
  updatedAt: string
}

export interface ReportArtifactInput {
  artifactType: string
  accessUrl: string
  versionLabel?: string
  collectedAt?: string
  note?: string | null
}

export interface ReportTargetInput {
  targetType: string
  targetId: string
}

export interface ReportBuildInput {
  serviceId?: string | null
  environment?: string | null
  buildKey: string
  versionLabel: string
  commitRef?: string | null
  source: string
  sourceRunId?: string | null
  collectedAt: string
  resultStatus: string
  note?: string | null
  artifacts?: ReportArtifactInput[]
  targets?: ReportTargetInput[]
}

export interface CorrectBuildInput {
  version: number
  versionLabel?: string
  commitRef?: string | null
  resultStatus?: string
  note?: string | null
  reason: string
}

export interface BuildListFilters {
  serviceId?: string
  environment?: string
  source?: string
  resultStatus?: string
  page: number
  pageSize: number
}

/** 上报者类型；Web 会话与 API Token 分别记录。 */
export type ReporterKind = 'web' | 'api_token' | 'cli'

export interface DeliveryServiceDeps {
  db: Database
}

/**
 * 创建交付服务：构建记录、产物引用与事项关联的读写用例。
 * @param deps 数据库连接。
 * @returns 上报、查询、更正、补报产物与关联用例。
 */
export function createDeliveryService(deps: DeliveryServiceDeps) {
  const { db } = deps
  const requireProject = createProjectAccess(db)
  const artifactUseCases = createArtifactUseCases({ db, requireProject })
  const runVersionUseCases = createRunVersionUseCases({ db, requireProject })
  const pipelineRunUseCases = createPipelineRunUseCases({ db, requireProject })
  const reviewUseCases = createReviewUseCases({ db, requireProject })
  const releaseUseCases = createReleaseUseCases({ db, requireProject })

  async function resolveService(projectId: string, serviceId: string | null | undefined) {
    if (!serviceId) return null
    const service = await findProjectServiceById(db, serviceId)
    if (!service || service.project_id !== projectId) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '服务不属于当前项目')
    }
    if (service.status !== 'active') throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '服务已停用，不能用于上报')
    return service
  }

  async function loadTarget(targetType: string, targetId: string) {
    const summary =
      targetType === 'requirement'
        ? await findRequirementSummaryById(db, targetId)
        : await findBugSummaryById(db, targetId)
    if (!summary) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联事项不存在')
    return summary
  }

  async function validateTargets(projectId: string, targets: ReportTargetInput[] | undefined) {
    const result: { targetType: string; targetId: string; title: string; number: number }[] = []
    for (const target of targets ?? []) {
      const type = validateBuildTargetType(target.targetType)
      const summary = await loadTarget(type, target.targetId)
      if (summary.projectId !== projectId) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联事项不属于当前项目')
      result.push({ targetType: type, targetId: summary.id, title: summary.title, number: summary.number })
    }
    return result
  }

  function artifactView(row: Awaited<ReturnType<typeof insertArtifact>>): BuildArtifactView {
    return {
      id: row.id,
      artifactType: toArtifactType(row.artifact_type),
      versionLabel: row.version_label,
      accessUrl: row.access_url,
      source: validateArtifactSource(row.source),
      collectedAt: toIso(row.collected_at) ?? '',
      status: toArtifactStatus(row.status),
      note: row.note,
    }
  }

  async function buildViews(rows: Awaited<ReturnType<typeof findBuilds>>['rows'], includeCorrections: boolean) {
    const ids = rows.map((row) => row.id)
    const [artifacts, targets] = await Promise.all([listArtifactsForBuilds(db, ids), listTargetsForBuilds(db, ids)])
    const artifactMap = new Map<string, BuildArtifactView[]>()
    for (const row of artifacts) {
      const list = artifactMap.get(row.build_id) ?? []
      list.push(artifactView(row))
      artifactMap.set(row.build_id, list)
    }
    const targetItems = await Promise.all(
      targets.map(async (row) => {
        const type = validateBuildTargetType(row.target_type)
        const summary = await loadTarget(type, row.target_id)
        const item: BuildTargetView = {
          id: row.id,
          targetType: type,
          targetId: row.target_id,
          title: summary.title,
          number: summary.number,
        }
        return { buildId: row.build_id, item }
      }),
    )
    const targetMap = new Map<string, BuildTargetView[]>()
    for (const entry of targetItems) {
      const list = targetMap.get(entry.buildId) ?? []
      list.push(entry.item)
      targetMap.set(entry.buildId, list)
    }
    return Promise.all(
      rows.map(async (row): Promise<BuildView> => {
        const corrections = includeCorrections
          ? (await listCorrections(db, row.id)).map((item) => ({
              id: item.id,
              reason: item.reason,
              correctedByUserId: item.corrected_by_user_id,
              correctedAt: toIso(item.created_at) ?? '',
            }))
          : []
        return {
          id: row.id,
          projectId: row.project_id,
          serviceId: row.service_id,
          environment: row.environment ? toEnvironment(row.environment) : null,
          buildKey: row.build_key,
          versionLabel: row.version_label,
          commitRef: row.commit_ref,
          source: validateBuildSource(row.source),
          sourceRunId: row.source_run_id,
          collectedAt: toIso(row.collected_at) ?? '',
          resultStatus: toBuildResultStatus(row.result_status),
          note: row.note,
          artifacts: artifactMap.get(row.id) ?? [],
          targets: targetMap.get(row.id) ?? [],
          corrections,
          version: row.version,
          createdAt: toIso(row.created_at) ?? '',
          updatedAt: toIso(row.updated_at) ?? '',
        }
      }),
    )
  }

  async function singleBuildView(buildId: string): Promise<BuildView> {
    const row = await findBuildById(db, buildId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
    const [view] = await buildViews([row], true)
    if (!view) throw new Error('构建视图映射失败')
    return view
  }

  async function reportBuild(
    actor: SessionUser,
    projectId: string,
    input: ReportBuildInput,
    reporterKind: ReporterKind,
  ): Promise<BuildView> {
    const context = await requireProject(actor, projectId, true)
    const buildKey = requireText(input.buildKey, '构建标识', 200)
    const versionLabel = requireText(input.versionLabel, '版本标识', 200)
    const source = validateBuildSource(input.source)
    const resultStatus = validateBuildResultStatus(input.resultStatus)
    const collectedAt = validateCollectedAt(input.collectedAt)
    const environment = input.environment ? validateEnvironment(input.environment) : null
    const note = optionalText(input.note, '说明', 2000)
    const service = await resolveService(projectId, input.serviceId)
    const artifacts = (input.artifacts ?? []).map((artifact) => ({
      artifactType: validateArtifactType(artifact.artifactType),
      accessUrl: validateAccessUrl(artifact.accessUrl),
      versionLabel: artifact.versionLabel ? requireText(artifact.versionLabel, '产物版本', 200) : versionLabel,
      collectedAt: artifact.collectedAt ? validateCollectedAt(artifact.collectedAt) : collectedAt,
      source: validateArtifactSource(input.source === 'manual' ? 'manual' : 'pipeline'),
      note: optionalText(artifact.note, '产物说明', 2000),
    }))
    if (artifacts.length === 0 && !note) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '至少提供一条产物引用或说明')
    }
    const targets = await validateTargets(projectId, input.targets)
    const existing = await findBuildByBusinessKey(db, projectId, source, buildKey)
    if (existing) return singleBuildView(existing.id)

    const buildId = randomUUID()
    try {
      await db.transaction(async (tx) => {
        const row = await insertBuild(tx, {
          id: buildId,
          teamId: context.teamId,
          projectId,
          serviceId: service?.id ?? null,
          environment,
          buildKey,
          versionLabel,
          commitRef: optionalText(input.commitRef, '提交标识', 200),
          source,
          sourceRunId: optionalText(input.sourceRunId, '来源运行标识', 200),
          collectedAt,
          resultStatus,
          note,
          reportedByUserId: actor.id,
          reporterKind,
        })
        for (const artifact of artifacts) {
          await insertArtifact(tx, {
            id: randomUUID(),
            teamId: context.teamId,
            projectId,
            buildId: row.id,
            artifactType: artifact.artifactType,
            versionLabel: artifact.versionLabel,
            accessUrl: artifact.accessUrl,
            source: artifact.source,
            collectedAt: artifact.collectedAt,
            note: artifact.note,
            createdByUserId: actor.id,
          })
        }
        for (const target of targets) {
          await insertTarget(tx, {
            id: randomUUID(),
            teamId: context.teamId,
            projectId,
            buildId: row.id,
            targetType: target.targetType,
            targetId: target.targetId,
            createdByUserId: actor.id,
          })
        }
        await appendActivity(tx, {
          teamId: context.teamId,
          projectId,
          entityType: 'build_record',
          entityId: row.id,
          action: 'build_record_reported',
          actorUserId: actor.id,
          changes: { versionLabel, source, resultStatus },
        })
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const concurrent = await findBuildByBusinessKey(db, projectId, source, buildKey)
      if (concurrent) return singleBuildView(concurrent.id)
      throw error
    }
    return singleBuildView(buildId)
  }

  async function getBuild(actor: SessionUser, buildId: string): Promise<BuildView> {
    const row = await findBuildById(db, buildId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
    await requireProject(actor, row.project_id, false)
    return singleBuildView(buildId)
  }

  async function listBuilds(
    actor: SessionUser,
    projectId: string,
    filters: BuildListFilters,
  ): Promise<PageView<BuildView>> {
    await requireProject(actor, projectId, false)
    validatePage(filters.page, filters.pageSize)
    const environment = filters.environment ? validateEnvironment(filters.environment) : undefined
    const source = filters.source ? validateBuildSource(filters.source) : undefined
    const resultStatus = filters.resultStatus ? validateBuildResultStatus(filters.resultStatus) : undefined
    const { rows, total } = await findBuilds(db, projectId, { ...filters, environment, source, resultStatus })
    return pageView(await buildViews(rows, false), filters.page, filters.pageSize, total)
  }

  async function correctBuild(actor: SessionUser, buildId: string, input: CorrectBuildInput): Promise<BuildView> {
    const existing = await findBuildById(db, buildId)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
    const context = await requireProject(actor, existing.project_id, true)
    const reason = validateReason(input.reason)
    const fields: {
      versionLabel?: string
      commitRef?: string | null
      resultStatus?: string
      note?: string | null
    } = {}
    if (input.versionLabel !== undefined) fields.versionLabel = requireText(input.versionLabel, '版本标识', 200)
    if (input.commitRef !== undefined) fields.commitRef = optionalText(input.commitRef, '提交标识', 200)
    if (input.resultStatus !== undefined) fields.resultStatus = validateBuildResultStatus(input.resultStatus)
    if (input.note !== undefined) fields.note = optionalText(input.note, '说明', 2000)
    if (Object.keys(fields).length === 0) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '没有需要更正的字段')

    await db.transaction(async (tx) => {
      const row = await lockBuildForUpdate(tx, buildId)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
      if (row.version !== input.version) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '构建记录已被其他操作修改')
      const updated = await updateBuildFields(tx, buildId, input.version, fields)
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '构建记录已被其他操作修改')
      await insertCorrection(tx, {
        id: randomUUID(),
        teamId: context.teamId,
        projectId: existing.project_id,
        buildId,
        previousSnapshot: {
          versionLabel: row.version_label,
          commitRef: row.commit_ref,
          resultStatus: row.result_status,
          note: row.note,
        },
        correctedFields: fields as Record<string, unknown>,
        reason,
        correctedByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId: context.teamId,
        projectId: existing.project_id,
        entityType: 'build_record',
        entityId: buildId,
        action: 'build_record_corrected',
        actorUserId: actor.id,
        reason,
        changes: fields,
      })
    })
    return singleBuildView(buildId)
  }

  async function addArtifact(actor: SessionUser, buildId: string, input: ReportArtifactInput): Promise<BuildView> {
    const existing = await findBuildById(db, buildId)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
    const context = await requireProject(actor, existing.project_id, true)
    const artifact = {
      artifactType: validateArtifactType(input.artifactType),
      accessUrl: validateAccessUrl(input.accessUrl),
      versionLabel: input.versionLabel ? requireText(input.versionLabel, '产物版本', 200) : existing.version_label,
      collectedAt: input.collectedAt ? validateCollectedAt(input.collectedAt) : existing.collected_at,
      note: optionalText(input.note, '产物说明', 2000),
    }
    await db.transaction(async (tx) => {
      await insertArtifact(tx, {
        id: randomUUID(),
        teamId: context.teamId,
        projectId: existing.project_id,
        buildId,
        artifactType: artifact.artifactType,
        versionLabel: artifact.versionLabel,
        accessUrl: artifact.accessUrl,
        source: 'manual',
        collectedAt: artifact.collectedAt,
        note: artifact.note,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId: context.teamId,
        projectId: existing.project_id,
        entityType: 'build_artifact',
        entityId: existing.id,
        action: 'build_artifact_added',
        actorUserId: actor.id,
        changes: { artifactType: artifact.artifactType },
      })
    })
    return singleBuildView(buildId)
  }

  async function linkTarget(actor: SessionUser, buildId: string, input: ReportTargetInput): Promise<BuildView> {
    const existing = await findBuildById(db, buildId)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
    const context = await requireProject(actor, existing.project_id, true)
    const targetType = validateBuildTargetType(input.targetType)
    const summary = await loadTarget(targetType, input.targetId)
    if (summary.projectId !== existing.project_id)
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联事项不属于当前项目')
    try {
      await db.transaction(async (tx) => {
        await insertTarget(tx, {
          id: randomUUID(),
          teamId: context.teamId,
          projectId: existing.project_id,
          buildId,
          targetType,
          targetId: summary.id,
          createdByUserId: actor.id,
        })
        await appendActivity(tx, {
          teamId: context.teamId,
          projectId: existing.project_id,
          entityType: 'build_record',
          entityId: buildId,
          action: 'build_record_target_linked',
          actorUserId: actor.id,
          changes: { targetType, targetId: summary.id },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '该事项已关联此构建')
      throw error
    }
    return singleBuildView(buildId)
  }

  async function unlinkTarget(
    actor: SessionUser,
    buildId: string,
    targetId: string,
    reason: string,
  ): Promise<BuildView> {
    const existing = await findBuildById(db, buildId)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '构建记录不存在')
    const context = await requireProject(actor, existing.project_id, true)
    const link = await findTarget(db, buildId, 'requirement', targetId)
    const bugLink = link ?? (await findTarget(db, buildId, 'bug', targetId))
    if (!bugLink) throw new ApiError(ERROR_CODES.NOT_FOUND, '关联不存在')
    const trimmedReason = validateReason(reason)
    await db.transaction(async (tx) => {
      await deleteTarget(tx, buildId, targetId)
      await appendActivity(tx, {
        teamId: context.teamId,
        projectId: existing.project_id,
        entityType: 'build_record',
        entityId: buildId,
        action: 'build_record_target_removed',
        actorUserId: actor.id,
        reason: trimmedReason,
      })
    })
    return singleBuildView(buildId)
  }

  return {
    reportBuild,
    getBuild,
    listBuilds,
    correctBuild,
    addArtifact,
    linkTarget,
    unlinkTarget,
    ...artifactUseCases,
    ...runVersionUseCases,
    ...pipelineRunUseCases,
    ...reviewUseCases,
    ...releaseUseCases,
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
