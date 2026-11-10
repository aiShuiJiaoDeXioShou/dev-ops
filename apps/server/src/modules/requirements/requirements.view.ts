import type { UserRef } from '../identity/identity.display.ts'
import { userRefOf } from '../identity/identity.display.ts'
import { toContentMode, toRequirementStatus } from './requirements.rules.ts'
import type { RequirementListRow, RequirementRow, RequirementSubmissionRow } from './requirements.repository.ts'
import type {
  LinkedBugView,
  LinkedCodeReferenceView,
  RequirementDetail,
  RequirementListItem,
  TestSubmissionView,
} from './requirements.types.ts'

/** 需求列表项映射输入。 */
export interface RequirementListMapping {
  row: RequirementListRow
  refs: Map<string, UserRef>
}

/** 需求详情映射输入；关联数据由 service 批量加载后传入。 */
export interface RequirementDetailMapping {
  row: RequirementRow
  collaborators: Array<{ userId: string }>
  latestSubmission: RequirementSubmissionRow | null
  linkedBugs: LinkedBugView[]
  linkedCodeReferences: LinkedCodeReferenceView[]
  refs: Map<string, UserRef>
}

/**
 * 把需求列表投影行映射为 API 列表项。
 * @param input 数据库行与已批量加载的用户引用。
 * @returns 需求列表项。
 */
export function toRequirementListItem(input: RequirementListMapping): RequirementListItem {
  const { row, refs } = input
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    status: toRequirementStatus(row.status),
    devOwner: userRefOf(row.dev_owner_user_id, refs),
    testOwner: userRefOf(row.test_owner_user_id, refs),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * 把提测记录行映射为 API 视图。
 * @param row 提测记录行。
 * @returns 提测记录视图。
 */
export function toTestSubmissionView(row: RequirementSubmissionRow): TestSubmissionView {
  return {
    id: row.id,
    submittedByUserId: row.submitted_by_user_id,
    devOwnerUserId: row.dev_owner_user_id,
    testOwnerUserId: row.test_owner_user_id,
    scopeNote: row.scope_note,
    selfTestResult: row.self_test_result,
    selfTestNote: row.self_test_note,
    testEntry: row.test_entry,
    versionNote: row.version_note,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * 把需求行与关联数据映射为 API 详情。
 * @param input 需求行、负责人/协作人、提测记录、关联 Bug 与代码引用、用户引用。
 * @returns 需求详情视图。
 */
export function toRequirementDetail(input: RequirementDetailMapping): RequirementDetail {
  const { row, collaborators, latestSubmission, linkedBugs, linkedCodeReferences, refs } = input
  const needsReview =
    row.status === 'passed' && linkedBugs.some((bug) => bug.status !== 'resolved' && bug.status !== 'closed')
  return {
    ...toRequirementListItem({ row, refs }),
    teamId: row.team_id,
    contentMode: toContentMode(row.content_mode),
    contentMarkdown: row.content_markdown,
    externalUrl: row.external_url,
    externalSummary: row.external_summary,
    acceptanceCriteria: row.acceptance_criteria,
    collaborators: collaborators.map((item) => ({
      userId: item.userId,
      name: userRefOf(item.userId, refs)?.name ?? '未知用户',
    })),
    latestTestSubmission: latestSubmission === null ? null : toTestSubmissionView(latestSubmission),
    linkedBugs,
    needsReview,
    linkedCodeReferences,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
  }
}
