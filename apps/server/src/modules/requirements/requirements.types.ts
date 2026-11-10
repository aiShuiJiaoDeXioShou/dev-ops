import type { OwnerRef } from '../identity/identity.display.ts'
import type { RequirementStatus } from './requirements.rules.ts'

/** 需求摘要读模型：列表与跨模块关联展示所需的最小字段，不包含正文。 */
export interface RequirementSummary {
  id: string
  number: number
  title: string
  status: string
  projectId: string
  teamId: string
}

/** 需求列表项。 */
export interface RequirementListItem {
  id: string
  projectId: string
  number: number
  title: string
  status: RequirementStatus
  devOwner: OwnerRef | null
  testOwner: OwnerRef | null
  version: number
  updatedAt: string
  needsReview: boolean
}

/** 关联 Bug 摘要。 */
export interface LinkedBugView {
  id: string
  number: number
  title: string
  status: string
}

/** 提测记录视图。 */
export interface TestSubmissionView {
  id: string
  submittedByUserId: string
  devOwnerUserId: string
  testOwnerUserId: string
  scopeNote: string
  selfTestResult: string
  selfTestNote: string | null
  testEntry: string | null
  versionNote: string | null
  createdAt: string
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

/** 需求关联 Bug 读取能力。 */
export type RequirementBugReader = (requirementId: string) => Promise<LinkedBugView[]>

/** 需求关联代码引用读取能力。 */
export type RequirementCodeReferenceReader = (
  targetType: 'requirement' | 'bug',
  targetId: string,
) => Promise<LinkedCodeReferenceView[]>

/** 需求详情视图。 */
export interface RequirementDetail extends RequirementListItem {
  teamId: string
  contentMode: 'markdown' | 'external_link'
  contentMarkdown: string | null
  externalUrl: string | null
  externalSummary: string | null
  acceptanceCriteria: string | null
  collaborators: OwnerRef[]
  latestTestSubmission: TestSubmissionView | null
  linkedBugs: LinkedBugView[]
  needsReview: boolean
  linkedCodeReferences: LinkedCodeReferenceView[]
  createdAt: string
  createdByUserId: string
}
