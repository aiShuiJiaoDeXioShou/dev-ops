import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { requireActiveProjectService, type RequireProjectAccess } from './delivery.access.ts'
import { isUniqueConstraintError } from './delivery.errors.ts'
import {
  findPipelineRunById,
  findPipelineRunBySourceRun,
  findPipelineRunStatuses,
  findPipelineRuns,
  findRelatedBuilds,
  insertPipelineRun,
  insertPipelineRunStatus,
  updatePipelineRun,
  type PipelineRunListFilters,
  type PipelineRunUpdateFields,
} from './delivery.pipeline.repository.ts'
import {
  optionalText,
  requireText,
  validateExternalUrl,
  validatePipelineStatus,
  validatePipelineTriggerSource,
  validateTimestamp,
  validateTimeRange,
} from './delivery.validators.ts'
import {
  pageView,
  toPipelineRunStatusView,
  toPipelineRunView,
  toRelatedBuildView,
  type PageView,
  type PipelineRunDetailView,
  type PipelineRunView,
} from './delivery.view.ts'

/** 上报流水线运行的请求体；只记录外部事实，不触发外部执行。 */
export interface ReportPipelineRunInput {
  pipelineName: string
  pipelineKey: string
  serviceId?: string | null
  commitRef?: string | null
  triggerSource: string
  status: string
  startedAt?: string | null
  finishedAt?: string | null
  resultUrl?: string | null
  source: string
  sourceRunId: string
  reportedAt: string
}

/** 流水线运行列表筛选；from/to 为 UTC 日期，按开始时间过滤。 */
export interface PipelineRunListQuery {
  serviceId?: string
  status?: string
  from?: string
  to?: string
  page: number
  pageSize: number
}

export interface PipelineRunUseCaseDeps {
  db: Database
  requireProject: RequireProjectAccess
}

/**
 * 解析 UTC 日期窗口参数为当天毫秒边界。
 * @param value YYYY-MM-DD 日期。
 * @param name 字段中文名，用于错误说明。
 * @param boundary 取当天开始或结束。
 * @returns 当天 UTC 开始或结束时间。
 * @throws 日期格式不合法时抛出 VALIDATION_ERROR。
 */
function parseUtcDay(value: string, name: string, boundary: 'start' | 'end'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}必须为 YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不是有效日期`)
  return boundary === 'start' ? date : new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1)
}

/**
 * 创建流水线运行用例。
 * @param deps 数据库连接与项目访问校验。
 * @returns 上报运行、读取列表与读取详情用例；不提供触发/重跑/取消能力。
 */
export function createPipelineRunUseCases(deps: PipelineRunUseCaseDeps) {
  const { db, requireProject } = deps

  async function loadDetail(runId: string): Promise<PipelineRunDetailView> {
    const row = await findPipelineRunById(db, runId)
    if (!row) throw new Error('流水线运行写入后读取失败')
    const [statuses, relatedBuilds] = await Promise.all([
      findPipelineRunStatuses(db, row.id),
      row.source_run_id ? findRelatedBuilds(db, row.project_id, row.source_run_id) : Promise.resolve([]),
    ])
    return {
      ...toPipelineRunView(row),
      statusHistory: statuses.map(toPipelineRunStatusView),
      relatedBuilds: relatedBuilds.map(toRelatedBuildView),
    }
  }

  /**
   * 上报或更新一次外部流水线运行。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param input 流水线标识、状态、时间与来源运行标识。
   * @returns 运行详情视图；较旧或重复上报返回已记录的最新状态。
   * @throws 无写权限、服务停用、时间或枚举不合法时抛出 ApiError。
   */
  async function reportPipelineRun(
    actor: SessionUser,
    projectId: string,
    input: ReportPipelineRunInput,
  ): Promise<PipelineRunDetailView> {
    const context = await requireProject(actor, projectId, true)
    const pipelineName = requireText(input.pipelineName, '流水线名称', 120)
    const pipelineKey = requireText(input.pipelineKey, '流水线标识', 120)
    const source = requireText(input.source, '来源系统', 120)
    const sourceRunId = requireText(input.sourceRunId, '来源运行标识', 200)
    const triggerSource = validatePipelineTriggerSource(input.triggerSource)
    const status = validatePipelineStatus(input.status)
    const reportedAt = validateTimestamp(input.reportedAt, '上报时间')
    const startedAt = input.startedAt ? validateTimestamp(input.startedAt, '开始时间') : undefined
    const finishedAt = input.finishedAt ? validateTimestamp(input.finishedAt, '结束时间') : undefined
    validateTimeRange(startedAt, finishedAt)
    const resultUrl = input.resultUrl ? validateExternalUrl(input.resultUrl, '结果地址') : null
    const service =
      input.serviceId === undefined || input.serviceId === null
        ? input.serviceId
        : await requireActiveProjectService(db, projectId, input.serviceId)

    const existing = await findPipelineRunBySourceRun(db, projectId, source, sourceRunId)
    if (existing) {
      // 相同或更旧的上报时间按幂等/乱序处理：不覆盖已记录状态，也不重复写状态历史。
      if (reportedAt.getTime() <= existing.last_reported_at.getTime()) return loadDetail(existing.id)
      const fields: PipelineRunUpdateFields = {
        pipelineName,
        pipelineKey,
        triggerSource,
        status,
        ...(input.serviceId === undefined ? {} : { serviceId: service ? service.id : null }),
        ...(input.commitRef === undefined ? {} : { commitRef: optionalText(input.commitRef, '提交标识', 200) }),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(finishedAt === undefined ? {} : { finishedAt }),
        ...(input.resultUrl === undefined ? {} : { resultUrl }),
      }
      let applied = false
      await db.transaction(async (tx) => {
        const updated = await updatePipelineRun(tx, existing.id, reportedAt, fields)
        if (!updated) return
        applied = true
        await insertPipelineRunStatus(tx, {
          id: randomUUID(),
          teamId: context.teamId,
          projectId,
          pipelineRunId: existing.id,
          status,
          reportedAt,
          note: null,
        })
        await appendActivity(tx, {
          teamId: context.teamId,
          projectId,
          entityType: 'pipeline_run',
          entityId: existing.id,
          action: 'pipeline_run_status_updated',
          actorUserId: actor.id,
          changes: { previousStatus: existing.status, newStatus: status, sourceRunId },
        })
      })
      // 条件更新失败说明并发写入了更晚的上报，返回已记录的最新状态。
      if (!applied) return loadDetail(existing.id)
      return loadDetail(existing.id)
    }

    const runId = randomUUID()
    try {
      await db.transaction(async (tx) => {
        await insertPipelineRun(tx, {
          id: runId,
          teamId: context.teamId,
          projectId,
          serviceId: service ? service.id : null,
          pipelineName,
          pipelineKey,
          commitRef: optionalText(input.commitRef, '提交标识', 200),
          triggerSource,
          status,
          startedAt: startedAt ?? null,
          finishedAt: finishedAt ?? null,
          resultUrl,
          source,
          sourceRunId,
          lastReportedAt: reportedAt,
        })
        await insertPipelineRunStatus(tx, {
          id: randomUUID(),
          teamId: context.teamId,
          projectId,
          pipelineRunId: runId,
          status,
          reportedAt,
          note: null,
        })
        await appendActivity(tx, {
          teamId: context.teamId,
          projectId,
          entityType: 'pipeline_run',
          entityId: runId,
          action: 'pipeline_run_reported',
          actorUserId: actor.id,
          changes: { pipelineName, status, sourceRunId },
        })
      })
    } catch (error) {
      // 并发首次上报同一来源运行：唯一约束兜底，回读已存在记录按幂等返回。
      if (!isUniqueConstraintError(error)) throw error
      const concurrent = await findPipelineRunBySourceRun(db, projectId, source, sourceRunId)
      if (!concurrent) throw error
      return loadDetail(concurrent.id)
    }
    return loadDetail(runId)
  }

  /**
   * 分页查询项目流水线运行。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param filters 服务、状态、UTC 日期窗口与分页条件。
   * @returns 运行摘要分页，不包含状态历史。
   * @throws 项目不存在或无团队权限时抛出 ApiError；日期与分页不合法时抛出 VALIDATION_ERROR。
   */
  async function listPipelineRuns(
    actor: SessionUser,
    projectId: string,
    filters: PipelineRunListQuery,
  ): Promise<PageView<PipelineRunView>> {
    await requireProject(actor, projectId, false)
    validatePage(filters.page, filters.pageSize)
    const status = filters.status ? validatePipelineStatus(filters.status) : undefined
    const from = filters.from ? parseUtcDay(filters.from, '开始日期', 'start') : undefined
    const to = filters.to ? parseUtcDay(filters.to, '结束日期', 'end') : undefined
    if (from && to && from.getTime() > to.getTime()) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '开始日期不能晚于结束日期')
    }
    const repositoryFilters: PipelineRunListFilters = {
      serviceId: filters.serviceId,
      status,
      from,
      to,
      page: filters.page,
      pageSize: filters.pageSize,
    }
    const { rows, total } = await findPipelineRuns(db, projectId, repositoryFilters)
    return pageView(rows.map(toPipelineRunView), filters.page, filters.pageSize, total)
  }

  /**
   * 读取流水线运行详情与状态历史。
   * @param actor 当前登录用户。
   * @param runId 运行标识。
   * @returns 运行详情视图。
   * @throws 运行不存在时抛出 NOT_FOUND；无团队权限时抛出 FORBIDDEN。
   */
  async function getPipelineRun(actor: SessionUser, runId: string): Promise<PipelineRunDetailView> {
    const row = await findPipelineRunById(db, runId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '流水线运行不存在')
    await requireProject(actor, row.project_id, false)
    return loadDetail(runId)
  }

  return { reportPipelineRun, listPipelineRuns, getPipelineRun }
}
