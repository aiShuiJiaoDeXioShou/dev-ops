import type { OwnerRef } from '../identity/identity.display.ts'
import { ownerRefOf } from '../identity/identity.display.ts'
import type { RequirementSummary } from '../requirements/requirements.types.ts'
import { toBugStatus } from './bugs.rules.ts'
import type { BugListRow, BugRow, RegressionRow } from './bugs.repository.ts'
import type { BugDetail, BugListItem, LinkedCodeReferenceView, RegressionView } from './bugs.types.ts'

/**
 * 把 Bug 列表投影行映射为 API 列表项。
 * @param row 数据库投影行。
 * @param refs 已批量加载的用户引用。
 * @returns Bug 列表项。
 */
export function toBugListItem(row: BugListRow, refs: Map<string, OwnerRef>): BugListItem {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    status: toBugStatus(row.status),
    fixOwner: ownerRefOf(row.fix_owner_user_id, refs),
    regressionOwner: ownerRefOf(row.regression_owner_user_id, refs),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * 把回归记录行映射为 API 视图。
 * @param row 回归记录行。
 * @param refs 已批量加载的用户引用。
 * @returns 回归记录视图。
 */
export function toRegressionView(row: RegressionRow, refs: Map<string, OwnerRef>): RegressionView {
  return {
    id: row.id,
    attempt: row.attempt,
    fixSummary: row.fix_summary,
    fixer: ownerRefOf(row.fixer_user_id, refs) ?? {
      userId: row.fixer_user_id,
      name: '未知用户',
      status: 'missing',
      available: false,
    },
    verifier: ownerRefOf(row.verifier_user_id, refs) ?? {
      userId: row.verifier_user_id,
      name: '未知用户',
      status: 'missing',
      available: false,
    },
    result: row.result,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    verifiedAt: row.verified_at?.toISOString() ?? null,
  }
}

/** Bug 详情映射输入；关联数据由 service 批量加载后传入。 */
export interface BugDetailMapping {
  row: BugRow
  linkedRequirements: RequirementSummary[]
  regressions: RegressionRow[]
  linkedCodeReferences: LinkedCodeReferenceView[]
  refs: Map<string, OwnerRef>
}

/**
 * 把 Bug 行与关联数据映射为 API 详情。
 * @param input Bug 行、关联需求、回归记录、代码引用与用户引用。
 * @returns Bug 详情视图。
 */
export function toBugDetail(input: BugDetailMapping): BugDetail {
  const { row, linkedRequirements, regressions, linkedCodeReferences, refs } = input
  return {
    ...toBugListItem(row, refs),
    teamId: row.team_id,
    phenomenon: row.phenomenon,
    expectedBehavior: row.expected_behavior,
    reproduction: row.reproduction,
    reproductionUnknown: row.reproduction_unknown,
    evidenceText: row.evidence_text,
    evidenceUrl: row.evidence_url,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    linkedRequirements: linkedRequirements.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      status: item.status,
    })),
    regressions: regressions.map((item) => toRegressionView(item, refs)),
    linkedCodeReferences,
  }
}
