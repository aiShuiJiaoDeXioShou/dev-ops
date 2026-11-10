import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { findIdempotency, recordIdempotency, requestHash } from '../../platform/http/idempotency.ts'
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
import { findActiveTeamMemberIds, isActiveTeamMember } from '../identity/identity.repository.ts'
import { loadUserRefs } from '../identity/identity.display.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { getProjectContext, lockProjectForWrite } from '../projects/projects.access.ts'
import { EDITABLE_STATUSES, normalizeTitle, validateContent, validateStatus } from './requirements.rules.ts'
import {
  countOpenRequirementsByProjects,
  findCollaborators,
  findRequirementById,
  findRequirements,
  findLatestSubmission,
  findTestSubmissions,
  insertRequirement,
  insertTestSubmission,
  lockRequirement,
  nextRequirementNumber,
  replaceCollaborators,
  updateRequirement,
  updateRequirementState,
  type RequirementRow,
} from './requirements.repository.ts'
import type { RequirementBugReader, RequirementCodeReferenceReader, RequirementDetail } from './requirements.types.ts'
import { toRequirementDetail, toRequirementListItem, toTestSubmissionView } from './requirements.view.ts'

export interface RequirementsServiceDeps {
  db: Database
  bugs?: RequirementBugReader
  codeReferences?: RequirementCodeReferenceReader
}

/** 创建需求服务。 */
function requiredTextInService(value: string, name: string, maxLength = 20_000): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

function reasonTextInService(value: string, name: string): string {
  return requiredTextInService(value, name, 2000)
}

export function createRequirementsService(deps: RequirementsServiceDeps) {
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

  async function requireRequirement(actor: SessionUser, requirementId: string) {
    const row = await findRequirementById(db, requirementId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '需求不存在')
    const project = await requireProjectAccess(actor, row.project_id)
    return { row, project }
  }

  async function toDetail(row: RequirementRow): Promise<RequirementDetail> {
    const [collaboratorRows, latestSubmission, linkedBugs, linkedCodeReferences] = await Promise.all([
      findCollaborators(db, row.id),
      findLatestSubmission(db, row.id),
      deps.bugs ? deps.bugs(row.id) : Promise.resolve([]),
      deps.codeReferences ? deps.codeReferences('requirement', row.id) : Promise.resolve([]),
    ])
    const ownerUserIds = [
      ...(row.dev_owner_user_id === null ? [] : [row.dev_owner_user_id]),
      ...(row.test_owner_user_id === null ? [] : [row.test_owner_user_id]),
      ...collaboratorRows.map((item) => item.userId),
    ]
    const refs = await loadUserRefs(db, ownerUserIds)
    return toRequirementDetail({
      row,
      collaborators: collaboratorRows,
      latestSubmission: latestSubmission ?? null,
      linkedBugs,
      linkedCodeReferences,
      refs,
    })
  }

  async function validateOwners(
    teamId: string,
    devOwnerUserId?: string | null,
    testOwnerUserId?: string | null,
    collaboratorUserIds?: string[],
  ) {
    const uniqueCollaborators = [...new Set(collaboratorUserIds ?? [])]
    const candidateUserIds = [devOwnerUserId, testOwnerUserId, ...uniqueCollaborators].filter(
      (userId): userId is string => userId !== null && userId !== undefined,
    )
    const activeMemberIds = await findActiveTeamMemberIds(db, teamId, candidateUserIds)
    if (devOwnerUserId && !activeMemberIds.has(devOwnerUserId)) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '研发主负责人不是正常团队成员')
    }
    if (testOwnerUserId && !activeMemberIds.has(testOwnerUserId)) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '测试负责人不是正常团队成员')
    }
    for (const userId of uniqueCollaborators) {
      if (!activeMemberIds.has(userId)) {
        throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '协作人员不是正常团队成员')
      }
    }
    return uniqueCollaborators
  }

  async function listRequirements(
    actor: SessionUser,
    projectId: string,
    filters: { search?: string; status?: string; ownerId?: string; page?: number; pageSize?: number },
  ) {
    await requireProjectAccess(actor, projectId)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    validatePage(page, pageSize)
    if (filters.status) validateStatus(filters.status)
    const { rows, total } = await findRequirements(db, projectId, {
      search: filters.search?.trim() || undefined,
      status: filters.status,
      ownerId: filters.ownerId,
      page,
      pageSize,
    })
    const ownerUserIds = rows.flatMap((row) =>
      row.dev_owner_user_id === null && row.test_owner_user_id === null
        ? []
        : [row.dev_owner_user_id, row.test_owner_user_id].filter((userId): userId is string => userId !== null),
    )
    const ownerRefs = await loadUserRefs(db, ownerUserIds)
    const items = rows.map((row) => toRequirementListItem({ row, refs: ownerRefs }))
    return { items, page, pageSize, total }
  }

  async function createRequirement(
    actor: SessionUser,
    projectId: string,
    input: {
      title: string
      contentMode: string
      contentMarkdown?: string | null
      externalUrl?: string | null
      externalSummary?: string | null
      acceptanceCriteria?: string | null
      devOwnerUserId?: string | null
      testOwnerUserId?: string | null
      collaboratorUserIds?: string[]
    },
  ) {
    const project = await requireProjectWrite(actor, projectId)
    const title = normalizeTitle(input.title)
    const content = validateContent(input)
    const collaborators = await validateOwners(
      project.teamId,
      input.devOwnerUserId,
      input.testOwnerUserId,
      input.collaboratorUserIds,
    )
    const acceptance = input.acceptanceCriteria?.trim()
    if (acceptance !== undefined && acceptance.length > 20_000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '验收标准不能超过 20000 个字符')
    }
    const requirementId = randomUUID()
    const row = await db.transaction(async (tx) => {
      await lockProjectForWrite(tx, projectId)
      const number = await nextRequirementNumber(tx, projectId)
      const created = await insertRequirement(tx, {
        id: requirementId,
        teamId: project.teamId,
        projectId,
        number,
        title,
        contentMode: content.contentMode,
        contentMarkdown: content.contentMarkdown,
        externalUrl: content.externalUrl,
        externalSummary: content.externalSummary,
        acceptanceCriteria: acceptance && acceptance.length > 0 ? acceptance : null,
        devOwnerUserId: input.devOwnerUserId ?? null,
        testOwnerUserId: input.testOwnerUserId ?? null,
        createdByUserId: actor.id,
      })
      if (collaborators.length > 0) {
        await replaceCollaborators(tx, requirementId, project.teamId, collaborators, actor.id)
      }
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId,
        entityType: 'requirement',
        entityId: requirementId,
        action: 'requirement_created',
        actorUserId: actor.id,
      })
      return created
    })
    return toDetail(row)
  }

  async function getRequirement(actor: SessionUser, requirementId: string) {
    const { row } = await requireRequirement(actor, requirementId)
    return toDetail(row)
  }

  async function updateRequirementDetails(
    actor: SessionUser,
    requirementId: string,
    input: {
      version: number
      title?: string
      contentMode?: string
      contentMarkdown?: string | null
      externalUrl?: string | null
      externalSummary?: string | null
      acceptanceCriteria?: string | null
      devOwnerUserId?: string | null
      testOwnerUserId?: string | null
      collaboratorUserIds?: string[]
    },
  ) {
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '版本参数不合法')
    }
    const { row: current, project } = await requireRequirement(actor, requirementId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (!EDITABLE_STATUSES.has(current.status)) {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '当前需求状态不允许修改范围字段')
    }
    const title = input.title === undefined ? undefined : normalizeTitle(input.title)
    const content =
      input.contentMode === undefined
        ? undefined
        : validateContent({
            contentMode: input.contentMode,
            contentMarkdown: input.contentMarkdown ?? current.content_markdown,
            externalUrl: input.externalUrl ?? current.external_url,
            externalSummary: input.externalSummary ?? current.external_summary,
          })
    if (
      input.contentMode === undefined &&
      (input.contentMarkdown !== undefined || input.externalUrl !== undefined || input.externalSummary !== undefined)
    ) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '修改内容时必须同时指定内容方式')
    }
    const acceptance = input.acceptanceCriteria === undefined ? undefined : (input.acceptanceCriteria ?? '').trim()
    if (acceptance !== undefined && acceptance.length > 20_000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '验收标准不能超过 20000 个字符')
    }
    const collaborators =
      input.collaboratorUserIds === undefined
        ? undefined
        : await validateOwners(project.teamId, input.devOwnerUserId, input.testOwnerUserId, input.collaboratorUserIds)
    if (collaborators === undefined && (input.devOwnerUserId !== undefined || input.testOwnerUserId !== undefined)) {
      await validateOwners(project.teamId, input.devOwnerUserId, input.testOwnerUserId, [])
    }

    const changes: Record<string, unknown> = {}
    if (title !== undefined && title !== current.title) changes.title = [current.title, title]
    if (content && content.contentMode !== current.content_mode)
      changes.contentMode = [current.content_mode, content.contentMode]
    if (acceptance !== undefined && acceptance !== current.acceptance_criteria)
      changes.acceptanceCriteria = [current.acceptance_criteria, acceptance || null]
    if (input.devOwnerUserId !== undefined && input.devOwnerUserId !== current.dev_owner_user_id)
      changes.devOwner = [current.dev_owner_user_id, input.devOwnerUserId]
    if (input.testOwnerUserId !== undefined && input.testOwnerUserId !== current.test_owner_user_id)
      changes.testOwner = [current.test_owner_user_id, input.testOwnerUserId]

    const row = await db.transaction(async (tx) => {
      await lockRequirement(tx, requirementId)
      const updated = await updateRequirement(tx, requirementId, input.version, {
        title,
        contentMode: content?.contentMode,
        contentMarkdown: content?.contentMarkdown,
        externalUrl: content?.externalUrl,
        externalSummary: content?.externalSummary,
        acceptanceCriteria: acceptance === undefined ? undefined : acceptance.length > 0 ? acceptance : null,
        devOwnerUserId: input.devOwnerUserId,
        testOwnerUserId: input.testOwnerUserId,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '需求已被更新，请刷新后重试')
      if (collaborators !== undefined) {
        await replaceCollaborators(tx, requirementId, project.teamId, collaborators, actor.id)
      }
      if (Object.keys(changes).length > 0) {
        await appendActivity(tx, {
          teamId: project.teamId,
          projectId: project.id,
          entityType: 'requirement',
          entityId: requirementId,
          action: 'requirement_updated',
          actorUserId: actor.id,
          changes,
        })
      }
      return updated
    })
    return toDetail(row)
  }

  async function addRequirementComment(actor: SessionUser, requirementId: string, bodyMarkdown: string) {
    const { project } = await requireRequirement(actor, requirementId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    return addComment(db, {
      teamId: project.teamId,
      projectId: project.id,
      entityType: 'requirement',
      entityId: requirementId,
      authorUserId: actor.id,
      bodyMarkdown,
    })
  }

  async function listRequirementComments(
    actor: SessionUser,
    requirementId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<CommentView>> {
    await requireRequirement(actor, requirementId)
    return listComments(db, 'requirement', requirementId, page, pageSize)
  }

  async function listRequirementActivities(
    actor: SessionUser,
    requirementId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<ActivityView>> {
    await requireRequirement(actor, requirementId)
    return listActivities(db, 'requirement', requirementId, page, pageSize)
  }

  async function requireWorkflow(actor: SessionUser, requirementId: string) {
    const { row, project } = await requireRequirement(actor, requirementId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (
      !EDITABLE_STATUSES.has(row.status) &&
      !['submitted', 'in_testing', 'passed', 'cancelled'].includes(row.status)
    ) {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '当前需求状态不允许该操作')
    }
    return { row, project }
  }

  async function activeOwner(teamId: string, userId: string | null, name: string): Promise<string> {
    if (!userId) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, `请先指定${name}`)
    if (!(await isActiveTeamMember(db, teamId, userId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, `${name}不是正常团队成员`)
    }
    return userId
  }

  async function transition(
    actor: SessionUser,
    requirementId: string,
    input: { version: number; status: string },
    action: string,
    options: {
      reason?: string
      note?: string
      changes?: Record<string, unknown>
      owners?: { devOwnerUserId?: string | null; testOwnerUserId?: string | null }
    } = {},
  ) {
    const { project } = await requireRequirement(actor, requirementId)
    const row = await db.transaction(async (tx) => {
      await lockRequirement(tx, requirementId)
      const updated = await updateRequirementState(tx, requirementId, input.version, {
        status: input.status,
        ...(options.owners ?? {}),
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '需求已被更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'requirement',
        entityId: requirementId,
        action,
        actorUserId: actor.id,
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.note === undefined ? {} : { note: options.note }),
        ...(options.changes === undefined ? {} : { changes: options.changes }),
      })
      return updated
    })
    return toDetail(row)
  }

  async function startDevelopment(actor: SessionUser, requirementId: string, input: { version: number }) {
    const { row, project } = await requireWorkflow(actor, requirementId)
    if (row.status !== 'pending') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待处理需求可以开始开发')
    const owner = await activeOwner(project.teamId, row.dev_owner_user_id, '研发负责人')
    return transition(
      actor,
      requirementId,
      { version: input.version, status: 'in_development' },
      'development_started',
      {
        changes: { devOwnerUserId: owner },
      },
    )
  }

  async function submitTest(
    actor: SessionUser,
    requirementId: string,
    input: {
      version: number
      testOwnerUserId: string
      scopeNote: string
      selfTestResult: string
      selfTestNote?: string | null
      testEntry?: string | null
      versionNote?: string | null
      idempotencyKey?: string
    },
  ) {
    const { row: current, project } = await requireWorkflow(actor, requirementId)
    const scope = 'requirement.submit-test'
    if (input.idempotencyKey) {
      const existing = await findIdempotency(db, {
        teamId: project.teamId,
        actorUserId: actor.id,
        scope,
        key: input.idempotencyKey,
      })
      if (existing) throw new ApiError(ERROR_CODES.IDEMPOTENCY_CONFLICT, '请求已处理，请刷新后查看结果')
    }
    if (current.status !== 'in_development')
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有开发中需求可以提测')
    const devOwnerId = await activeOwner(project.teamId, current.dev_owner_user_id, '研发负责人')
    await activeOwner(project.teamId, input.testOwnerUserId, '测试负责人')
    const scopeNote = requiredTextInService(input.scopeNote, '测试范围')
    const selfTestNote = input.selfTestNote?.trim() ?? ''
    if (input.selfTestResult !== 'passed' && selfTestNote.length === 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '非通过的自测结论必须填写自测说明')
    }
    if (!['passed', 'has_failures', 'not_run', 'not_applicable'].includes(input.selfTestResult)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '自测结论不合法')
    }
    const submissionId = randomUUID()
    const result = await db.transaction(async (tx) => {
      await lockRequirement(tx, requirementId)
      if (input.idempotencyKey) {
        await recordIdempotency(tx, {
          teamId: project.teamId,
          actorUserId: actor.id,
          scope,
          key: input.idempotencyKey,
          hash: requestHash({ requirementId, input }),
          responseEntityType: 'requirement_test_submission',
          responseEntityId: submissionId,
        })
      }
      const submission = await insertTestSubmission(tx, {
        id: submissionId,
        teamId: project.teamId,
        requirementId,
        submittedByUserId: actor.id,
        devOwnerUserId: devOwnerId,
        testOwnerUserId: input.testOwnerUserId,
        scopeNote,
        selfTestResult: input.selfTestResult,
        selfTestNote: selfTestNote.length > 0 ? selfTestNote : null,
        testEntry: input.testEntry?.trim() || null,
        versionNote: input.versionNote?.trim() || null,
      })
      const updated = await updateRequirementState(tx, requirementId, input.version, {
        status: 'submitted',
        testOwnerUserId: input.testOwnerUserId,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '需求已被更新，请刷新后重试')
      const activity = await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'requirement',
        entityId: requirementId,
        action: 'test_submitted',
        actorUserId: actor.id,
        note: scopeNote,
      })
      return { updated, submission, activityId: activity.id }
    })
    return {
      requirement: await toDetail(result.updated),
      submission: toTestSubmissionView(result.submission),
      activityId: result.activityId,
    }
  }

  async function startTest(actor: SessionUser, requirementId: string, input: { version: number }) {
    const { row, project } = await requireWorkflow(actor, requirementId)
    if (row.status !== 'submitted') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待测试需求可以开始测试')
    await activeOwner(project.teamId, row.test_owner_user_id, '测试负责人')
    return transition(actor, requirementId, { version: input.version, status: 'in_testing' }, 'test_started')
  }

  async function withdrawTest(actor: SessionUser, requirementId: string, input: { version: number; reason: string }) {
    const { row } = await requireWorkflow(actor, requirementId)
    if (row.status !== 'submitted') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有待测试需求可以撤回测试')
    return transition(actor, requirementId, { version: input.version, status: 'in_development' }, 'test_withdrawn', {
      reason: reasonTextInService(input.reason, '撤回原因'),
    })
  }

  async function returnToDevelopment(
    actor: SessionUser,
    requirementId: string,
    input: { version: number; reason: string; linkedBugIds?: string[] },
  ) {
    const { row } = await requireWorkflow(actor, requirementId)
    if (row.status !== 'in_testing') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有测试中需求可以退回')
    return transition(actor, requirementId, { version: input.version, status: 'in_development' }, 'test_returned', {
      reason: reasonTextInService(input.reason, '退回原因'),
      ...(input.linkedBugIds ? { changes: { linkedBugIds: input.linkedBugIds } } : {}),
    })
  }

  async function testPassEligibility(actor: SessionUser, requirementId: string) {
    const { row } = await requireRequirement(actor, requirementId)
    const linkedBugs = deps.bugs ? await deps.bugs(requirementId) : []
    const blockers = linkedBugs.filter((bug) => bug.status !== 'resolved' && bug.status !== 'closed')
    return { eligible: row.status === 'in_testing' && blockers.length === 0, blockers }
  }

  async function passTest(actor: SessionUser, requirementId: string, input: { version: number; conclusion: string }) {
    const { row } = await requireWorkflow(actor, requirementId)
    if (row.status !== 'in_testing') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有测试中需求可以通过')
    const eligibility = await testPassEligibility(actor, requirementId)
    if (!eligibility.eligible) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '关联 Bug 未全部解决或关闭', {
        blockers: eligibility.blockers,
      })
    }
    return transition(actor, requirementId, { version: input.version, status: 'passed' }, 'test_passed', {
      note: reasonTextInService(input.conclusion, '测试结论'),
    })
  }

  async function reopenDevelopment(
    actor: SessionUser,
    requirementId: string,
    input: { version: number; reason: string },
  ) {
    const { row } = await requireWorkflow(actor, requirementId)
    if (row.status !== 'passed') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有已通过需求可以重新开发')
    return transition(
      actor,
      requirementId,
      { version: input.version, status: 'in_development' },
      'development_reopened',
      {
        reason: reasonTextInService(input.reason, '重新开发原因'),
      },
    )
  }

  async function cancelRequirement(
    actor: SessionUser,
    requirementId: string,
    input: { version: number; reason: string },
  ) {
    const { row } = await requireRequirement(actor, requirementId)
    await requireTeamMember(db, actor.id, row.team_id, ['admin', 'developer'])
    if (!['pending', 'in_development', 'submitted', 'in_testing', 'passed'].includes(row.status)) {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '当前需求状态不允许取消')
    }
    return transition(actor, requirementId, { version: input.version, status: 'cancelled' }, 'requirement_cancelled', {
      reason: reasonTextInService(input.reason, '取消原因'),
    })
  }

  async function restoreRequirement(
    actor: SessionUser,
    requirementId: string,
    input: { version: number; reason: string },
  ) {
    const { row, project } = await requireRequirement(actor, requirementId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    if (row.status !== 'cancelled') throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '只有已取消需求可以恢复')
    if (row.dev_owner_user_id) await activeOwner(project.teamId, row.dev_owner_user_id, '研发负责人')
    if (row.test_owner_user_id) await activeOwner(project.teamId, row.test_owner_user_id, '测试负责人')
    return transition(actor, requirementId, { version: input.version, status: 'pending' }, 'requirement_restored', {
      reason: reasonTextInService(input.reason, '恢复原因'),
    })
  }

  async function listTestSubmissionHistory(actor: SessionUser, requirementId: string, page: number, pageSize: number) {
    await requireRequirement(actor, requirementId)
    validatePage(page, pageSize)
    const { rows, total } = await findTestSubmissions(db, requirementId, page, pageSize)
    return { items: rows.map(toTestSubmissionView), page, pageSize, total }
  }

  async function countOpenRequirements(projectIds: string[]): Promise<Map<string, number>> {
    return countOpenRequirementsByProjects(db, projectIds)
  }

  return {
    listRequirements,
    createRequirement,
    getRequirement,
    updateRequirement: updateRequirementDetails,
    addComment: addRequirementComment,
    listComments: listRequirementComments,
    listActivities: listRequirementActivities,
    countOpenRequirements,
    startDevelopment,
    submitTest,
    startTest,
    withdrawTest,
    returnToDevelopment,
    testPassEligibility,
    passTest,
    reopenDevelopment,
    cancelRequirement,
    restoreRequirement,
    listTestSubmissions: listTestSubmissionHistory,
  }
}

export type RequirementsService = ReturnType<typeof createRequirementsService>
