import type { UserRef } from '../identity/identity.display.ts'

/** Bug 摘要读模型：列表与跨模块关联展示所需的最小字段，不包含现象与复现正文。 */
export interface BugSummary {
  id: string
  number: number
  title: string
  status: string
  projectId: string
  teamId: string
}

/** 关联到需求的 Bug 摘要，供需求详情与测试通过资格判断。 */
export interface BugSummaryForRequirement {
  id: string
  number: number
  title: string
  status: string
}

/** Bug 负责人展示引用。 */
export type OwnerView = UserRef

/** Bug 列表项。 */
export interface BugListItem {
  id: string
  projectId: string
  number: number
  title: string
  status: import('./bugs.rules.ts').BugStatus
  fixOwner: OwnerView | null
  regressionOwner: OwnerView | null
  version: number
  updatedAt: string
}

/** 回归记录视图。 */
export interface RegressionView {
  id: string
  attempt: number
  fixSummary: string
  fixer: OwnerView
  verifier: OwnerView
  result: string
  failureReason: string | null
  createdAt: string
  verifiedAt: string | null
}

/** 关联需求摘要视图。 */
export interface LinkedRequirementView {
  id: string
  number: number
  title: string
  status: string
}

/** 关联代码引用视图。 */
export interface LinkedCodeReferenceView {
  id: string
  repositoryId: string
  targetType: string
  targetId: string
  objectType: string
  remoteId: string
  title: string | null
  state: string | null
  url: string | null
  lastCheckStatus: string
  lastErrorCode: string | null
  lastCheckedAt: string | null
}

/** Bug 详情视图。 */
export interface BugDetail extends BugListItem {
  teamId: string
  phenomenon: string
  expectedBehavior: string
  reproduction: string | null
  reproductionUnknown: boolean
  evidenceText: string | null
  evidenceUrl: string | null
  createdByUserId: string
  createdAt: string
  linkedRequirements: LinkedRequirementView[]
  regressions: RegressionView[]
  linkedCodeReferences: LinkedCodeReferenceView[]
}

/** Bug 关联代码引用读取能力。 */
export type BugCodeReferenceReader = (
  targetType: 'requirement' | 'bug',
  targetId: string,
) => Promise<LinkedCodeReferenceView[]>
