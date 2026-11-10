import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import {
  addComment,
  appendActivity,
  listActivities,
  listComments,
  type ActivityView,
  type CommentView,
  type PageResult,
} from '../collaboration/collaboration.service.ts'
import { isActiveTeamMember } from '../identity/identity.repository.ts'
import { loadUserRefs } from '../identity/identity.display.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { getProjectContext, lockProjectForWrite } from '../projects/projects.access.ts'
import { findRequirementSummaries, findRequirementSummaryById } from '../requirements/requirements.repository.ts'
import {
  countOpenBugsByProjects,
  deleteBugLink,
  findBugById,
  findBugLink,
  findBugSummariesForRequirement,
  findBugRequirementIds,
  findBugs,
  findPendingRegression,
  insertBug,
  insertBugLink,
  insertRegression,
  listRegressions,
  lockBug,
  nextBugNumber,
  nextRegressionAttempt,
  updateBug,
  updateRegression,
  type BugRow,
} from './bugs.repository.ts'
import {
  EDITABLE_BUG_STATUSES,
  normalizeBugTitle,
  optionalHttpUrl,
  optionalText,
  reasonText,
  requiredText,
  validateBugStatus,
  validateCloseReason,
  validateReproduction,
  type CloseReason,
} from './bugs.rules.ts'
import type { BugCodeReferenceReader, BugDetail } from './bugs.types.ts'
import { toBugDetail, toBugListItem, toRegressionView } from './bugs.view.ts'

export interface BugsServiceDeps {
  db: Database
  codeReferences?: BugCodeReferenceReader
}

/**
 * 创建 Bug 服务。
 * @param deps 数据库连接。
 * @returns Bug 列表、详情、状态动作、关联、评论与活动用例。
 */
export function createBugsService(deps: BugsServiceDeps) {
  const { db } = deps

  async function requireProjectAccess(actor: SessionUser, projectId: string) {
    const project = await getProjectContext(db, projectId)
    if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, project.teamId)
    return project
  }

  async function requireProjectWrite(actor: SessionUser, projectId: string) {
    const project = await requireProjectAccess(actor, projectId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    return project
  }

  async function requireBug(actor: SessionUser, bugId: string) {
    const row = await findBugById(db, bugId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Bug 不存在')
    const project = await requireProjectAccess(actor, row.project_id)
    return { row, project }
  }

  async function detail(row: BugRow): Promise<BugDetail> {
    const [requirementIds, regressions, linkedCodeReferences] = await Promise.all([
      findBugRequirementIds(db, row.id),
      listRegressions(db, row.id),
      deps.codeReferences ? deps.codeReferences('bug', row.id) : Promise.resolve([]),
    ])
    const ownerUserIds = [
      ...(row.fix_owner_user_id === null ? [] : [row.fix_owner_user_id]),
      ...(row.regression_owner_user_id === null ? [] : [row.regression_owner_user_id]),
      ...regressions.flatMap((item) => [item.fixer_user_id, item.verifier_user_id]),
    ]
    const [linkedRequirements, refs] = await Promise.all([
      findRequirementSummaries(
        db,
        requirementIds.map((item) => item.requirementId),
      ),
      loadUserRefs(db, ownerUserIds),
    ])
    return toBugDetail({ row, linkedRequirements, regressions, linkedCodeReferences, refs })
  }

  async function listBugs(
    actor: SessionUser,
    projectId: string,
    filters: { search?: string; status?: string; ownerId?: string; page?: number; pageSize?: number },
  ) {
    await requireProjectAccess(actor, projectId)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    validatePage(page, pageSize)
    if (filters.status) validateBugStatus(filters.status)
    const { rows, total } = await findBugs(db, projectId, {
      search: filters.search?.trim() || undefined,
      status: filters.status,
      ownerId: filters.ownerId,
      page,
      pageSize,
    })
    const ownerUserIds = rows.flatMap((row) =>
      [row.fix_owner_user_id, row.regression_owner_user_id].filter((userId): userId is string => userId !== null),
    )
    const ownerRefs = await loadUserRefs(db, ownerUserIds)
    const items = rows.map((row) => toBugListItem(row, ownerRefs))
    return { items, page, pageSize, total }
  }

  async function createBug(
    actor: SessionUser,
    projectId: string,
    input: {
      title: string
      phenomenon: string
      expectedBehavior: string
      reproduction?: string | null
      reproductionUnknown?: boolean
      evidenceText?: string | null
      evidenceUrl?: string | null
      fixOwnerUserId?: string | null
      requirementIds?: string[]
    },
  ) {
    const project = await requireProjectWrite(actor, projectId)
    const title = normalizeBugTitle(input.title)
    const phenomenon = requiredText(input.phenomenon, '现象')
    const expectedBehavior = requiredText(input.expectedBehavior, '预期行为')
    const repro = validateReproduction(input.reproduction, input.reproductionUnknown ?? false)
    const evidenceText = optionalText(input.evidenceText, '证据文本')
    const evidenceUrl = optionalHttpUrl(input.evidenceUrl)
    if (input.fixOwnerUserId && !(await isActiveTeamMember(db, project.teamId, input.fixOwnerUserId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '修复负责人不是正常团队成员')
    }
    const requirementIds = [...new Set(input.requirementIds ?? [])]
    const requirementSummaries = await findRequirementSummaries(db, requirementIds)
    if (
      requirementSummaries.length !== requirementIds.length ||
      requirementSummaries.some((requirement) => requirement.projectId !== projectId)
    ) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '只能关联同项目需求')
    }
    const bugId = randomUUID()
    const row = await db.transaction(async (tx) => {
      await lockProjectForWrite(tx, projectId)
      const number = await nextBugNumber(tx, projectId)
      const created = await insertBug(tx, {
        id: bugId,
        teamId: project.teamId,
        projectId,
        number,
        title,
        phenomenon,
        expectedBehavior,
        reproduction: repro.reproduction,
        reproductionUnknown: repro.reproductionUnknown,
        evidenceText,
        evidenceUrl,
        fixOwnerUserId: input.fixOwnerUserId ?? null,
        regressionOwnerUserId: null,
        createdByUserId: actor.id,
      })
      for (const requirementId of requirementIds) {
        await insertBugLink(tx, { teamId: project.teamId, bugId, requirementId, createdByUserId: actor.id })
      }
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId,
        entityType: 'bug',
        entityId: bugId,
        action: 'bug_created',
        actorUserId: actor.id,
      })
      return created
    })
    return detail(row)
  }

  async function getBug(actor: SessionUser, bugId: string) {
    const { row } = await requireBug(actor, bugId)
    return detail(row)
  }

  async function updateBugDetails(
    actor: SessionUser,
    bugId: string,
    input: {
      version: number
      title?: string
      phenomenon?: string
      expectedBehavior?: string
      reproduction?: string | null
      reproductionUnknown?: boolean
      evidenceText?: string | null
      evidenceUrl?: string | null
      fixOwnerUserId?: string | null
    },
  ) {
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '版本参数不合法')
    }
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (!EDITABLE_BUG_STATUSES.has(current.status)) {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '当前 Bug 状态不允许直接修改现象、预期与复现信息')
    }
    const title = input.title === undefined ? undefined : normalizeBugTitle(input.title)
    const phenomenon = input.phenomenon === undefined ? undefined : requiredText(input.phenomenon, '现象')
    const expectedBehavior =
      input.expectedBehavior === undefined ? undefined : requiredText(input.expectedBehavior, '预期行为')
    let repro: { reproduction: string | null; reproductionUnknown: boolean } | undefined
    if (input.reproduction !== undefined || input.reproductionUnknown !== undefined) {
      repro = validateReproduction(
        input.reproduction === undefined ? current.reproduction : input.reproduction,
        input.reproductionUnknown ?? current.reproduction_unknown,
      )
    }
    const evidenceText = input.evidenceText === undefined ? undefined : optionalText(input.evidenceText, '证据文本')
    const evidenceUrl = input.evidenceUrl === undefined ? undefined : optionalHttpUrl(input.evidenceUrl)
    if (input.fixOwnerUserId && !(await isActiveTeamMember(db, project.teamId, input.fixOwnerUserId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '修复负责人不是正常团队成员')
    }
    const changes: Record<string, unknown> = {}
    if (title !== undefined && title !== current.title) changes.title = [current.title, title]
    if (phenomenon !== undefined && phenomenon !== current.phenomenon)
      changes.phenomenon = [current.phenomenon, phenomenon]
    if (expectedBehavior !== undefined && expectedBehavior !== current.expected_behavior)
      changes.expectedBehavior = [current.expected_behavior, expectedBehavior]
    if (
      repro !== undefined &&
      (repro.reproduction !== current.reproduction || repro.reproductionUnknown !== current.reproduction_unknown)
    ) {
      changes.reproduction = [current.reproduction, repro.reproduction]
    }
    if (input.fixOwnerUserId !== undefined && input.fixOwnerUserId !== current.fix_owner_user_id)
      changes.fixOwner = [current.fix_owner_user_id, input.fixOwnerUserId]

    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const updated = await updateBug(tx, bugId, input.version, {
        title,
        phenomenon,
        expectedBehavior,
        reproduction: repro?.reproduction,
        reproductionUnknown: repro?.reproductionUnknown,
        evidenceText,
        evidenceUrl,
        fixOwnerUserId: input.fixOwnerUserId,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      if (Object.keys(changes).length > 0) {
        await appendActivity(tx, {
          teamId: project.teamId,
          projectId: project.id,
          entityType: 'bug',
          entityId: bugId,
          action: 'bug_updated',
          actorUserId: actor.id,
          changes,
        })
      }
      return updated
    })
    return detail(row)
  }

  async function startFix(actor: SessionUser, bugId: string, input: { version: number }) {
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (current.status !== 'pending') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待处理 Bug 可以开始修复')
    const ownerId = current.fix_owner_user_id
    if (!ownerId) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '开始修复必须指定修复负责人')
    if (!(await isActiveTeamMember(db, project.teamId, ownerId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '修复负责人不是正常团队成员')
    }
    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const updated = await updateBug(tx, bugId, input.version, { status: 'in_fix', fixOwnerUserId: ownerId })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: 'fix_started',
        actorUserId: actor.id,
      })
      return updated
    })
    return detail(row)
  }

  async function submitRegression(
    actor: SessionUser,
    bugId: string,
    input: { version: number; fixSummary: string; verifierUserId?: string },
  ) {
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (current.status !== 'in_fix') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有修复中 Bug 可以提交回归')
    const fixSummary = requiredText(input.fixSummary, '修复说明')
    const verifierId = input.verifierUserId ?? current.regression_owner_user_id ?? current.created_by_user_id
    if (!(await isActiveTeamMember(db, project.teamId, verifierId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '回归负责人不是正常团队成员')
    }
    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const attempt = await nextRegressionAttempt(tx, bugId)
      const regression = await insertRegression(tx, {
        id: randomUUID(),
        teamId: project.teamId,
        bugId,
        attempt,
        fixSummary,
        fixerUserId: actor.id,
        verifierUserId: verifierId,
      })
      const updated = await updateBug(tx, bugId, input.version, {
        status: 'in_regression',
        regressionOwnerUserId: verifierId,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      const activity = await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: 'regression_submitted',
        actorUserId: actor.id,
        note: fixSummary,
      })
      return { updated, regression, activityId: activity.id }
    })
    const regressionNames = await loadUserRefs(db, [row.regression.fixer_user_id, row.regression.verifier_user_id])
    return {
      bug: await detail(row.updated),
      regression: toRegressionView(row.regression, regressionNames),
      activityId: row.activityId,
    }
  }

  async function withdrawRegression(actor: SessionUser, bugId: string, input: { version: number; reason: string }) {
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (current.status !== 'in_regression')
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待回归 Bug 可以撤回回归')
    const reason = reasonText(input.reason, '撤回原因')
    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const pending = await findPendingRegression(tx, bugId)
      if (!pending) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '没有待处理的回归记录')
      await updateRegression(tx, pending.id, { result: 'withdrawn', failureReason: reason, verifiedAt: new Date() })
      const updated = await updateBug(tx, bugId, input.version, { status: 'in_fix' })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: 'regression_withdrawn',
        actorUserId: actor.id,
        reason,
      })
      return updated
    })
    return detail(row)
  }

  async function recordRegression(
    actor: SessionUser,
    bugId: string,
    input: { version: number; result: 'passed' | 'failed'; note: string },
  ) {
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (current.status !== 'in_regression')
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待回归 Bug 可以记录回归结论')
    if (input.result !== 'passed' && input.result !== 'failed')
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '回归结果不合法')
    const note = reasonText(input.note, '回归结论')
    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const pending = await findPendingRegression(tx, bugId)
      if (!pending) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '没有待处理的回归记录')
      await updateRegression(tx, pending.id, {
        result: input.result,
        failureReason: input.result === 'failed' ? note : null,
        verifiedAt: new Date(),
      })
      const updated = await updateBug(tx, bugId, input.version, {
        status: input.result === 'passed' ? 'resolved' : 'in_fix',
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: input.result === 'passed' ? 'regression_passed' : 'regression_failed',
        actorUserId: actor.id,
        note,
      })
      return updated
    })
    return detail(row)
  }

  async function closeBug(
    actor: SessionUser,
    bugId: string,
    input: { version: number; category: CloseReason; note: string; duplicateOfBugId?: string },
  ) {
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (!['pending', 'in_fix', 'in_regression'].includes(current.status)) {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '当前 Bug 状态不允许关闭')
    }
    const closeReason = validateCloseReason(input.category)
    const note = reasonText(input.note, '关闭说明')
    if (closeReason === 'duplicate') {
      if (!input.duplicateOfBugId) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '重复 Bug 必须指定原 Bug')
      const duplicate = await findBugById(db, input.duplicateOfBugId)
      if (!duplicate || duplicate.project_id !== current.project_id || duplicate.id === bugId) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '原 Bug 不合法')
      }
    }
    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const pending = await findPendingRegression(tx, bugId)
      if (pending)
        await updateRegression(tx, pending.id, {
          result: 'withdrawn',
          failureReason: `关闭 Bug：${note}`,
          verifiedAt: new Date(),
        })
      const updated = await updateBug(tx, bugId, input.version, { status: 'closed' })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: 'bug_closed',
        actorUserId: actor.id,
        reason: note,
        changes: { closeReason, duplicateOfBugId: input.duplicateOfBugId ?? null },
      })
      return updated
    })
    return detail(row)
  }

  async function reopenBug(actor: SessionUser, bugId: string, input: { version: number; reason: string }) {
    const { row: current, project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (!['resolved', 'closed'].includes(current.status))
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有已解决或已关闭 Bug 可以重开')
    const reason = reasonText(input.reason, '重开原因')
    const row = await db.transaction(async (tx) => {
      await lockBug(tx, bugId)
      const updated = await updateBug(tx, bugId, input.version, { status: 'pending' })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: 'bug_reopened',
        actorUserId: actor.id,
        reason,
      })
      return updated
    })
    return detail(row)
  }

  async function linkRequirement(actor: SessionUser, bugId: string, requirementId: string, version: number) {
    const { row: current, project } = await requireBug(actor, bugId)
    if (version !== current.version) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    const requirement = await findRequirementSummaryById(db, requirementId)
    if (!requirement || requirement.projectId !== current.project_id) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '只能关联同项目需求')
    }
    if (await findBugLink(db, bugId, requirementId)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '需求已关联')
    try {
      await db.transaction(async (tx) => {
        await insertBugLink(tx, { teamId: project.teamId, bugId, requirementId, createdByUserId: actor.id })
        await appendActivity(tx, {
          teamId: project.teamId,
          projectId: project.id,
          entityType: 'bug',
          entityId: bugId,
          action: 'requirement_linked',
          actorUserId: actor.id,
          changes: { requirementId },
        })
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '需求已关联')
      }
      throw error
    }
    const refreshed = await findBugById(db, bugId)
    if (!refreshed) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Bug 不存在')
    return detail(refreshed)
  }

  async function removeRequirementLink(
    actor: SessionUser,
    bugId: string,
    requirementId: string,
    version: number,
    reason: string,
  ) {
    const { row: current, project } = await requireBug(actor, bugId)
    if (version !== current.version) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, 'Bug 已被更新，请刷新后重试')
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (!(await findBugLink(db, bugId, requirementId))) throw new ApiError(ERROR_CODES.NOT_FOUND, '关联不存在')
    const note = reasonText(reason, '移除原因')
    await db.transaction(async (tx) => {
      await deleteBugLink(tx, bugId, requirementId)
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'bug',
        entityId: bugId,
        action: 'requirement_unlinked',
        actorUserId: actor.id,
        reason: note,
        changes: { requirementId },
      })
    })
    const refreshed = await findBugById(db, bugId)
    if (!refreshed) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Bug 不存在')
    return detail(refreshed)
  }

  async function addBugComment(actor: SessionUser, bugId: string, bodyMarkdown: string) {
    const { project } = await requireBug(actor, bugId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    return addComment(db, {
      teamId: project.teamId,
      projectId: project.id,
      entityType: 'bug',
      entityId: bugId,
      authorUserId: actor.id,
      bodyMarkdown,
    })
  }

  async function listBugComments(
    actor: SessionUser,
    bugId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<CommentView>> {
    await requireBug(actor, bugId)
    return listComments(db, 'bug', bugId, page, pageSize)
  }

  async function listBugActivities(
    actor: SessionUser,
    bugId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<ActivityView>> {
    await requireBug(actor, bugId)
    return listActivities(db, 'bug', bugId, page, pageSize)
  }

  async function countOpenBugs(projectIds: string[]) {
    return countOpenBugsByProjects(db, projectIds)
  }

  async function listLinkedBugs(requirementId: string) {
    return findBugSummariesForRequirement(db, requirementId)
  }

  return {
    listBugs,
    createBug,
    getBug,
    updateBug: updateBugDetails,
    startFix,
    submitRegression,
    withdrawRegression,
    recordRegression,
    closeBug,
    reopenBug,
    linkRequirement,
    removeRequirementLink,
    addComment: addBugComment,
    listComments: listBugComments,
    listActivities: listBugActivities,
    countOpenBugs,
    listLinkedBugs,
  }
}

export type BugsService = ReturnType<typeof createBugsService>
