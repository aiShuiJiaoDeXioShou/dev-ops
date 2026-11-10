import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { findBugSummaryById } from '../bugs/bugs.repository.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { findRequirementSummaryById } from '../requirements/requirements.repository.ts'
import {
  countCodeReferencesForTarget,
  deleteCodeReference,
  deleteProjectRepository,
  findAvailableRepositories,
  findChangeRequestRemoteIdsForTarget,
  findCodeReferenceById,
  findCodeReferencesForTarget,
  findConnectionRepositories,
  findLinkedRepository,
  findProjectRepositories,
  findProjectRepositoryLink,
  findRepositoryById,
  insertCodeReference,
  insertProjectRepository,
  updateCodeReferenceCheck,
} from './code.repository.ts'

export type GitObjectType = 'commit' | 'issue' | 'change_request'
const TARGET_TYPES = new Set(['requirement', 'bug'])
const OBJECT_TYPES: ReadonlySet<string> = new Set(['commit', 'issue', 'change_request'])

/** 判断字符串是否为 Git 对象类型。 */
function isGitObjectType(value: string): value is GitObjectType {
  return OBJECT_TYPES.has(value)
}

/** 校验 Git 对象类型。 */
function validateGitObjectType(value: string): GitObjectType {
  if (!isGitObjectType(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '远端对象类型不合法')
  return value
}

/** 将数据库 Git 对象类型收窄为业务类型；数据不合法时说明是持久化异常。 */
function toGitObjectType(value: string): GitObjectType {
  if (!isGitObjectType(value)) throw new Error(`数据库 Git 对象类型不合法: ${value}`)
  return value
}
const GIT_ERROR_CODES = new Set([
  'timeout',
  'auth_failed',
  'not_found',
  'unavailable',
  'unsupported',
  'invalid_response',
])

export interface GitObjectSnapshotPort {
  objectType: GitObjectType
  remoteId: string
  title: string
  state: string
  url: string | null
}
/** 代码模块只依赖读取端口，不依赖具体 Git 适配器。 */
export interface GitTreeEntryPort {
  path: string
  type: 'file' | 'directory'
  size: number | null
}
export interface GitFileContentPort {
  path: string
  content: string
  truncated: boolean
}
/** 归一化 PR 状态；来源缺省时为 unknown，不得猜测。 */
export type PullRequestState = 'open' | 'closed' | 'merged' | 'unknown'
/** 归一化 PR 评审状态；来源不提供时为 unknown。 */
export type PullRequestReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'unknown'
/** 归一化变更文件状态；来源额外状态收窄为固定枚举。 */
export type PullRequestFileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'unknown'
/** PR 列表状态筛选；merged 在来源 API 中属于 closed。 */
export type PullRequestStateFilter = 'open' | 'closed' | 'all'

/** 代码读取端口返回的提交摘要，与接口提交列表项字段一致。 */
export interface GitCommitSummaryPort {
  sha: string
  title: string
  authorName: string
  committedAt: string
  url: string | null
}
export interface GitCommitFilePort {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
}
export interface GitCommitDetailPort extends GitCommitSummaryPort {
  files: GitCommitFilePort[]
  filesTruncated: boolean
  filesUnsupported: boolean
}
export interface GitPullRequestSummaryPort {
  number: number
  title: string
  authorName: string
  sourceBranch: string
  targetBranch: string
  state: PullRequestState
  reviewStatus: PullRequestReviewStatus
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  url: string | null
}
export interface GitPullRequestFilePort {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
  patch: string | null
  binary: boolean
  truncated: boolean
}
export interface GitPullRequestDetailPort extends GitPullRequestSummaryPort {
  files: GitPullRequestFilePort[]
  truncated: boolean
}
export interface GitPullRequestDiffPort {
  patch: string
  truncated: boolean
}
export interface GitReadPort {
  getObject(input: {
    repository: { namespace: string; name: string }
    objectType: GitObjectType
    remoteId: string
  }): Promise<GitObjectSnapshotPort>
  listTree?(input: { repository: { namespace: string; name: string }; ref: string }): Promise<GitTreeEntryPort[]>
  getFile?(input: {
    repository: { namespace: string; name: string }
    ref: string
    path: string
  }): Promise<GitFileContentPort>
  listBranches?(input: { repository: { namespace: string; name: string } }): Promise<string[]>
  listCommits?(input: {
    repository: { namespace: string; name: string }
    ref?: string
    page: number
    pageSize: number
  }): Promise<GitCommitSummaryPort[]>
  getCommit?(input: { repository: { namespace: string; name: string }; ref: string }): Promise<GitCommitDetailPort>
  listPullRequests?(input: {
    repository: { namespace: string; name: string }
    state?: PullRequestStateFilter
    author?: string
    page: number
    pageSize: number
  }): Promise<GitPullRequestSummaryPort[]>
  getPullRequest?(input: {
    repository: { namespace: string; name: string }
    number: number
  }): Promise<GitPullRequestDetailPort>
  getPullRequestDiff?(input: {
    repository: { namespace: string; name: string }
    number: number
  }): Promise<GitPullRequestDiffPort>
}

export interface RepositoryView {
  id: string
  connectionId: string
  providerKey: string
  namespace: string
  name: string
  webUrl: string
  defaultBranch: string | null
  status: string
}
export interface CodeReferenceView {
  id: string
  projectId: string
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
/** 提交列表项视图；lastCheckedAt 为本次从来源读取的时间。 */
export interface CommitSummaryView {
  sha: string
  title: string
  authorName: string
  committedAt: string
  url: string | null
  lastCheckedAt: string
}
/** 提交变更文件视图；只包含数量信息，不返回补丁。 */
export interface CommitFileView {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
}
/** 提交详情视图；filesUnsupported 表示来源不提供变更文件，filesTruncated 表示超过读取上限。 */
export interface CommitView extends CommitSummaryView {
  files: CommitFileView[]
  filesTruncated: boolean
  filesUnsupported: boolean
}
/** PR 变更文件视图；patch 为 null 表示来源不提供或超过截断上限。 */
export interface PullRequestFileView {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
  patch: string | null
  binary: boolean
  truncated: boolean
}
/** PR 视图；列表接口不加载变更文件，files 为空且 truncated 为 false。 */
export interface PullRequestView {
  number: number
  title: string
  authorName: string
  sourceBranch: string
  targetBranch: string
  state: PullRequestState
  reviewStatus: PullRequestReviewStatus
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  url: string | null
  lastCheckedAt: string
  files: PullRequestFileView[]
  truncated: boolean
}
/** 代码读取接口的稳定分页结果；total 为已读到的下限，来源不提供总数时可能低估。 */
export interface CodeReadPage<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}
export type GitAdapterResolver = (connectionId: string) => Promise<GitReadPort>
export type ActiveConnectionReader = (teamId: string) => Promise<string[]>

export interface CodeServiceDeps {
  db: Database
  resolveAdapter: GitAdapterResolver
  listActiveConnectionIds: ActiveConnectionReader
}

function repositoryView(row: Awaited<ReturnType<typeof findRepositoryById>> & object): RepositoryView {
  return {
    id: row.id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    namespace: row.namespace,
    name: row.name,
    webUrl: row.web_url,
    defaultBranch: row.default_branch,
    status: row.status,
  }
}

function referenceView(row: Awaited<ReturnType<typeof findCodeReferenceById>> & object): CodeReferenceView {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    targetType: row.target_type,
    targetId: row.target_id,
    objectType: row.object_type,
    remoteId: row.remote_id,
    title: row.title_snapshot,
    state: row.state_snapshot,
    url: row.url,
    lastCheckStatus: row.last_check_status,
    lastErrorCode: row.last_error_code,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
  }
}

/** 只传递适配器读取所需仓库标识，避免把团队、URL 等内部字段交给适配器。 */
function repositoryRef(repository: { namespace: string; name: string }): { namespace: string; name: string } {
  return { namespace: repository.namespace, name: repository.name }
}

function commitSummaryView(item: GitCommitSummaryPort, checkedAt: string): CommitSummaryView {
  return {
    sha: item.sha,
    title: item.title,
    authorName: item.authorName,
    committedAt: item.committedAt,
    url: item.url,
    lastCheckedAt: checkedAt,
  }
}

function commitDetailView(item: GitCommitDetailPort, checkedAt: string): CommitView {
  return {
    ...commitSummaryView(item, checkedAt),
    files: item.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
    filesTruncated: item.filesTruncated,
    filesUnsupported: item.filesUnsupported,
  }
}

function pullRequestFileView(item: GitPullRequestFilePort): PullRequestFileView {
  return {
    path: item.path,
    status: item.status,
    additions: item.additions,
    deletions: item.deletions,
    patch: item.patch,
    binary: item.binary,
    truncated: item.truncated,
  }
}

function pullRequestBaseView(item: GitPullRequestSummaryPort, checkedAt: string) {
  return {
    number: item.number,
    title: item.title,
    authorName: item.authorName,
    sourceBranch: item.sourceBranch,
    targetBranch: item.targetBranch,
    state: item.state,
    reviewStatus: item.reviewStatus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    mergedAt: item.mergedAt,
    url: item.url,
    lastCheckedAt: checkedAt,
  }
}

/** 列表接口不读取变更文件，明确返回空文件列表而不是伪造内容。 */
function pullRequestListView(item: GitPullRequestSummaryPort, checkedAt: string): PullRequestView {
  return { ...pullRequestBaseView(item, checkedAt), files: [], truncated: false }
}

function pullRequestDetailView(item: GitPullRequestDetailPort, checkedAt: string): PullRequestView {
  return {
    ...pullRequestBaseView(item, checkedAt),
    files: item.files.map(pullRequestFileView),
    truncated: item.truncated,
  }
}

/**
 * 估算列表总数。
 * @param itemCount 当前页条数。
 * @param page 当前页码。
 * @param pageSize 每页条数。
 * @returns 已读到的数量；满页时多计 1，表示来源可能还有下一页。
 * @remarks 提供方列表接口不返回总数，只能按页推断；客户端以实际条数判断末页。
 */
function pagedTotal(itemCount: number, page: number, pageSize: number): number {
  const consumed = (page - 1) * pageSize + itemCount
  return itemCount === pageSize ? consumed + 1 : consumed
}

function isUniqueError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueError(error.cause)
}

function gitErrorToCheckStatus(error: unknown): { status: string; errorCode: string } {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    GIT_ERROR_CODES.has(error.code)
  ) {
    const status = ['auth_failed', 'not_found', 'timeout', 'unavailable'].includes(error.code)
      ? error.code
      : 'unavailable'
    return { status, errorCode: error.code }
  }
  return { status: 'unavailable', errorCode: 'unavailable' }
}

/** 提取适配器错误码；非适配器错误或未约定错误码返回 null。 */
function gitAdapterErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = error.code
  return typeof code === 'string' && GIT_ERROR_CODES.has(code) ? code : null
}

/**
 * 创建代码仓库与引用服务。
 * @param deps 数据库、连接适配器解析器与团队可用连接读取器。
 * @returns 项目仓库、可关联仓库与代码引用用例。
 */
export function createCodeService(deps: CodeServiceDeps) {
  const { db } = deps

  async function requireProject(actor: SessionUser, projectId: string) {
    const project = await getProjectContext(db, projectId)
    if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, project.teamId)
    return project
  }

  async function requireProjectWrite(actor: SessionUser, projectId: string) {
    const project = await requireProject(actor, projectId)
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    return project
  }

  async function requireLinkedRepository(actor: SessionUser, projectId: string, repositoryId: string) {
    const project = await requireProject(actor, projectId)
    const repository = await findLinkedRepository(db, projectId, repositoryId)
    if (!repository || repository.team_id !== project.teamId) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '项目仓库关联不存在')
    }
    const connectionIds = await deps.listActiveConnectionIds(project.teamId)
    if (!connectionIds.includes(repository.connection_id)) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Git 连接不可用')
    }
    return { project, repository, adapter: await deps.resolveAdapter(repository.connection_id) }
  }

  /**
   * 把适配器读取失败映射为业务错误码。
   * @param error 适配器抛出的错误，约定带有 code 字段。
   * @throws 总是抛出 ApiError：授权失败、不存在、能力不支持、超时与不可用分别可区分，
   * 不允许把失败吞掉后返回空数据。
   */
  function repositoryReadError(error: unknown): never {
    const code = gitAdapterErrorCode(error)
    if (code === 'auth_failed') {
      throw new ApiError(ERROR_CODES.EXTERNAL_AUTH_FAILED, 'Git 来源授权不可用，请检查连接授权后重试')
    }
    if (code === 'not_found') throw new ApiError(ERROR_CODES.NOT_FOUND, '远端记录不存在')
    if (code === 'unsupported') throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 来源不支持该读取能力')
    if (code === 'timeout') throw new ApiError(ERROR_CODES.EXTERNAL_UNAVAILABLE, '读取 Git 来源超时，请稍后重试')
    throw new ApiError(ERROR_CODES.EXTERNAL_UNAVAILABLE, '读取 Git 来源失败，请检查连接状态后重试')
  }

  async function listRepositoryBranches(actor: SessionUser, projectId: string, repositoryId: string) {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.listBranches) {
      throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持浏览分支')
    }
    try {
      return await adapter.listBranches({ repository: { namespace: repository.namespace, name: repository.name } })
    } catch (error) {
      repositoryReadError(error)
    }
  }

  async function listRepositoryTree(actor: SessionUser, projectId: string, repositoryId: string, branch?: string) {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.listTree) throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持浏览文件')
    const ref = (branch?.trim() || repository.default_branch || '').trim()
    if (!ref) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库没有可用分支')
    try {
      const entries = await adapter.listTree({
        repository: { namespace: repository.namespace, name: repository.name },
        ref,
      })
      return { branch: ref, entries }
    } catch (error) {
      repositoryReadError(error)
    }
  }

  async function readRepositoryFileAtRef(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    refInput: string,
    pathInput: string,
  ) {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.getFile) throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取文件')
    const ref = refInput.trim()
    if (!ref) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'ref 不能为空')
    const path = pathInput.trim().replace(/^\/+/, '')
    if (!path || path.length > 500 || path.split('/').some((segment) => segment === '..' || segment === '')) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '文件路径不合法')
    }
    try {
      return {
        branch: ref,
        ...(await adapter.getFile({
          repository: { namespace: repository.namespace, name: repository.name },
          ref,
          path,
        })),
      }
    } catch (error) {
      repositoryReadError(error)
    }
  }

  async function getRepositoryFile(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { branch?: string; path: string },
  ) {
    const { repository } = await requireLinkedRepository(actor, projectId, repositoryId)
    const ref = (input.branch?.trim() || repository.default_branch || '').trim()
    if (!ref) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库没有可用分支')
    return readRepositoryFileAtRef(actor, projectId, repositoryId, ref, input.path)
  }

  async function listProjectRepositories(actor: SessionUser, projectId: string): Promise<RepositoryView[]> {
    await requireProject(actor, projectId)
    const rows = await findProjectRepositories(db, projectId)
    return rows.map((row) => repositoryView(row.repository))
  }

  async function listAvailableRepositories(
    actor: SessionUser,
    projectId: string,
    filters: { search?: string; page?: number; pageSize?: number },
  ) {
    const project = await requireProjectWrite(actor, projectId)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    validatePage(page, pageSize)
    const connectionIds = await deps.listActiveConnectionIds(project.teamId)
    const { rows, total } = await findAvailableRepositories(db, project.teamId, connectionIds, {
      search: filters.search?.trim() || undefined,
      page,
      pageSize,
    })
    return { items: rows.map(repositoryView), page, pageSize, total }
  }

  async function linkRepository(actor: SessionUser, projectId: string, repositoryId: string) {
    const project = await requireProjectWrite(actor, projectId)
    const repository = await findRepositoryById(db, repositoryId)
    if (!repository || repository.team_id !== project.teamId || repository.status !== 'available') {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库不可用或不属于当前团队')
    }
    const connectionIds = await deps.listActiveConnectionIds(project.teamId)
    if (!connectionIds.includes(repository.connection_id)) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Git 连接不可用')
    }
    if (await findProjectRepositoryLink(db, projectId, repositoryId)) {
      throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '仓库已关联')
    }
    await db.transaction(async (tx) => {
      await insertProjectRepository(tx, {
        id: randomUUID(),
        teamId: project.teamId,
        projectId,
        repositoryId,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId,
        entityType: 'code_reference',
        entityId: repositoryId,
        action: 'repository_linked',
        actorUserId: actor.id,
        changes: { repositoryId },
      })
    })
    return listProjectRepositories(actor, projectId)
  }

  async function unlinkRepository(actor: SessionUser, projectId: string, repositoryId: string, reason: string) {
    const project = await requireProjectWrite(actor, projectId)
    const note = reason.trim()
    if (note.length === 0 || note.length > 2000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '移除原因长度不合法')
    if (!(await findProjectRepositoryLink(db, projectId, repositoryId)))
      throw new ApiError(ERROR_CODES.NOT_FOUND, '项目仓库关联不存在')
    await db.transaction(async (tx) => {
      await deleteProjectRepository(tx, projectId, repositoryId)
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId,
        entityType: 'code_reference',
        entityId: repositoryId,
        action: 'repository_unlinked',
        actorUserId: actor.id,
        reason: note,
        changes: { repositoryId },
      })
    })
    return listProjectRepositories(actor, projectId)
  }

  async function validateTarget(projectId: string, targetType: string, targetId: string) {
    if (targetType === 'requirement') {
      const target = await findRequirementSummaryById(db, targetId)
      if (!target || target.projectId !== projectId)
        throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '需求不属于当前项目')
      return
    }
    const target = await findBugSummaryById(db, targetId)
    if (!target || target.projectId !== projectId)
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Bug 不属于当前项目')
  }

  async function createReference(
    actor: SessionUser,
    projectId: string,
    input: {
      targetType: string
      targetId: string
      repositoryId: string
      objectType: string
      remoteId: string
    },
  ) {
    if (!TARGET_TYPES.has(input.targetType)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联事项类型不合法')
    const objectType = validateGitObjectType(input.objectType)
    if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(input.remoteId))
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '远端对象标识不合法')
    const project = await requireProjectWrite(actor, projectId)
    await validateTarget(projectId, input.targetType, input.targetId)
    const link = await findProjectRepositoryLink(db, projectId, input.repositoryId)
    if (!link) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库未关联到项目')
    if ((await countCodeReferencesForTarget(db, input.targetType, input.targetId)) >= 20) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '单个事项最多关联 20 条代码引用')
    }
    const repository = await findRepositoryById(db, input.repositoryId)
    if (!repository || repository.status !== 'available')
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库不可用')
    let adapter: GitReadPort
    try {
      adapter = await deps.resolveAdapter(repository.connection_id)
    } catch {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Git 连接不可用')
    }
    let snapshot
    try {
      snapshot = await adapter.getObject({
        repository: { namespace: repository.namespace, name: repository.name },
        objectType,
        remoteId: input.remoteId,
      })
    } catch (error) {
      const mapped = gitErrorToCheckStatus(error)
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '远端对象核对失败', { errorCode: mapped.errorCode })
    }
    let row
    try {
      row = await insertCodeReference(db, {
        id: randomUUID(),
        teamId: project.teamId,
        projectId,
        repositoryId: input.repositoryId,
        targetType: input.targetType,
        targetId: input.targetId,
        objectType,
        remoteId: input.remoteId,
        title: snapshot.title,
        state: snapshot.state,
        url: snapshot.url,
        createdByUserId: actor.id,
      })
    } catch (error) {
      if (isUniqueError(error)) {
        throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '该代码引用已存在')
      }
      throw error
    }
    if (!row) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '代码引用保存失败')
    return referenceView(row)
  }

  async function refreshReference(actor: SessionUser, codeReferenceId: string) {
    const current = await findCodeReferenceById(db, codeReferenceId)
    if (!current) throw new ApiError(ERROR_CODES.NOT_FOUND, '代码引用不存在')
    await requireProject(actor, current.project_id)
    const repository = await findRepositoryById(db, current.repository_id)
    if (!repository) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库不可用')
    let adapter: GitReadPort
    try {
      adapter = await deps.resolveAdapter(repository.connection_id)
    } catch {
      return referenceView(
        (await updateCodeReferenceCheck(db, codeReferenceId, {
          status: 'unavailable',
          errorCode: 'unavailable',
          title: null,
          state: null,
          url: null,
          checkedAt: new Date(),
        })) ?? current,
      )
    }
    try {
      const snapshot = await adapter.getObject({
        repository: { namespace: repository.namespace, name: repository.name },
        objectType: toGitObjectType(current.object_type),
        remoteId: current.remote_id,
      })
      return referenceView(
        (await updateCodeReferenceCheck(db, codeReferenceId, {
          status: 'ok',
          errorCode: null,
          title: snapshot.title,
          state: snapshot.state,
          url: snapshot.url,
          checkedAt: new Date(),
        })) ?? current,
      )
    } catch (error) {
      const mapped = gitErrorToCheckStatus(error)
      return referenceView(
        (await updateCodeReferenceCheck(db, codeReferenceId, {
          status: mapped.status,
          errorCode: mapped.errorCode,
          title: null,
          state: null,
          url: null,
          checkedAt: new Date(),
        })) ?? current,
      )
    }
  }

  async function removeReference(actor: SessionUser, codeReferenceId: string, reason: string) {
    const current = await findCodeReferenceById(db, codeReferenceId)
    if (!current) throw new ApiError(ERROR_CODES.NOT_FOUND, '代码引用不存在')
    const project = await requireProjectWrite(actor, current.project_id)
    const note = reason.trim()
    if (note.length === 0 || note.length > 2000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '移除原因长度不合法')
    await db.transaction(async (tx) => {
      await deleteCodeReference(tx, codeReferenceId)
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: current.project_id,
        entityType: current.target_type as 'requirement' | 'bug',
        entityId: current.target_id,
        action: 'code_reference_removed',
        actorUserId: actor.id,
        reason: note,
        changes: { repositoryId: current.repository_id, objectType: current.object_type, remoteId: current.remote_id },
      })
    })
  }

  async function listReferences(actor: SessionUser, projectId: string, targetType: string, targetId: string) {
    await requireProject(actor, projectId)
    if (!TARGET_TYPES.has(targetType)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联事项类型不合法')
    const rows = await findCodeReferencesForTarget(db, targetType, targetId)
    return rows.map(referenceView)
  }

  async function listReferencesForTarget(targetType: string, targetId: string) {
    if (!TARGET_TYPES.has(targetType)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '关联事项类型不合法')
    const rows = await findCodeReferencesForTarget(db, targetType, targetId)
    return rows.map(referenceView)
  }

  async function listConnectionRepositoriesForActor(
    actor: SessionUser,
    teamId: string,
    connectionId: string,
    filters: { search?: string; page?: number; pageSize?: number },
  ) {
    await requireTeamMember(db, actor.id, teamId)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    const { rows, total } = await findConnectionRepositories(db, connectionId, {
      search: filters.search?.trim() || undefined,
      page,
      pageSize,
    })
    return { items: rows.map(repositoryView), page, pageSize, total }
  }

  /**
   * 读取提交列表。
   * @param actor 当前用户；任一正常项目成员（含浏览者）可读。
   * @param projectId 项目标识。
   * @param repositoryId 项目已关联仓库标识。
   * @param input 分支/提交标识与分页参数；ref 缺省使用仓库默认分支。
   * @returns 当前页提交摘要与分页元数据；每项带本次读取的 lastCheckedAt。
   * @throws 未认证、无项目权限、仓库未关联、连接不可用或来源读取失败时抛出 ApiError。
   */
  async function listRepositoryCommits(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { ref?: string; page?: number; pageSize?: number },
  ): Promise<CodeReadPage<CommitSummaryView>> {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.listCommits) {
      throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取提交')
    }
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    validatePage(page, pageSize)
    const ref = (input.ref?.trim() || repository.default_branch || '').trim()
    if (!ref) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库没有可用分支')
    try {
      const items = await adapter.listCommits({ repository: repositoryRef(repository), ref, page, pageSize })
      const checkedAt = new Date().toISOString()
      return {
        items: items.map((item) => commitSummaryView(item, checkedAt)),
        page,
        pageSize,
        total: pagedTotal(items.length, page, pageSize),
      }
    } catch (error) {
      repositoryReadError(error)
    }
  }

  /**
   * 读取提交详情。
   * @param actor 当前用户；任一正常项目成员（含浏览者）可读。
   * @param projectId 项目标识。
   * @param repositoryId 项目已关联仓库标识。
   * @param ref 分支、标签或提交标识；必须是来源稳定标识。
   * @returns 提交详情（含变更文件摘要与来源能力标记）。
   * @throws 来源不存在时为 NOT_FOUND，其余来源失败按类别映射。
   */
  async function getRepositoryCommit(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    ref: string,
  ): Promise<CommitView> {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.getCommit) throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取提交')
    const trimmedRef = ref.trim()
    if (!trimmedRef) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '提交标识不能为空')
    try {
      return commitDetailView(
        await adapter.getCommit({ repository: repositoryRef(repository), ref: trimmedRef }),
        new Date().toISOString(),
      )
    } catch (error) {
      repositoryReadError(error)
    }
  }

  /**
   * 读取 PR 列表。
   * @param actor 当前用户；任一正常项目成员（含浏览者）可读。
   * @param projectId 项目标识。
   * @param repositoryId 项目已关联仓库标识。
   * @param input 状态、作者、关联事项筛选与分页参数。
   * @returns 当前页 PR 摘要；列表不读取变更文件，files 为空，每项带本次读取的 lastCheckedAt。
   * @remarks 关联事项筛选先在平台内查已有代码引用，再按远端编号过滤；
   * 带关联事项筛选且未指定状态时默认返回全部状态，避免已合并 PR 被 open 条件遗漏。
   * 作者与关联事项过滤都发生在已读取页内，total 与分页为近似值。
   * @throws 未认证、无项目权限、仓库未关联、连接不可用或来源读取失败时抛出 ApiError。
   */
  async function listRepositoryPullRequests(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: {
      state?: PullRequestStateFilter
      author?: string
      linkedTargetId?: string
      page?: number
      pageSize?: number
    },
  ): Promise<CodeReadPage<PullRequestView>> {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.listPullRequests) {
      throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取 PR')
    }
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    validatePage(page, pageSize)
    const author = input.author?.trim() || undefined
    const linkedTargetId = input.linkedTargetId?.trim() || undefined
    let linkedRemoteIds: Set<string> | null = null
    if (linkedTargetId) {
      linkedRemoteIds = new Set(await findChangeRequestRemoteIdsForTarget(db, projectId, repositoryId, linkedTargetId))
      // 平台内没有关联记录时结果确实为空，无需请求来源，但已在前面完成权限与能力校验。
      if (linkedRemoteIds.size === 0) return { items: [], page, pageSize, total: 0 }
    }
    try {
      const items = await adapter.listPullRequests({
        repository: repositoryRef(repository),
        state: input.state ?? (linkedTargetId ? 'all' : 'open'),
        author,
        page,
        pageSize,
      })
      const matchedItems = linkedRemoteIds ? items.filter((item) => linkedRemoteIds.has(String(item.number))) : items
      const checkedAt = new Date().toISOString()
      return {
        items: matchedItems.map((item) => pullRequestListView(item, checkedAt)),
        page,
        pageSize,
        total: pagedTotal(matchedItems.length, page, pageSize),
      }
    } catch (error) {
      repositoryReadError(error)
    }
  }

  /**
   * 读取 PR 详情与变更文件。
   * @param actor 当前用户；任一正常项目成员（含浏览者）可读。
   * @param projectId 项目标识。
   * @param repositoryId 项目已关联仓库标识。
   * @param number 来源 PR 编号。
   * @returns PR 详情；差异超限或来源截断时 truncated 为 true。
   * @throws 来源不存在时为 NOT_FOUND，能力不支持为 EXTERNAL_UNSUPPORTED。
   */
  async function getRepositoryPullRequest(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    number: number,
  ): Promise<PullRequestView> {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.getPullRequest) {
      throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取 PR 详情')
    }
    try {
      return pullRequestDetailView(
        await adapter.getPullRequest({ repository: repositoryRef(repository), number }),
        new Date().toISOString(),
      )
    } catch (error) {
      repositoryReadError(error)
    }
  }

  /**
   * 读取 PR 合并差异文本。
   * @param actor 当前用户；任一正常项目成员（含浏览者）可读。
   * @param projectId 项目标识。
   * @param repositoryId 项目已关联仓库标识。
   * @param number 来源 PR 编号。
   * @returns 差异文本前缀与截断标记；来源不提供差异时返回 EXTERNAL_UNSUPPORTED。
   * @throws 来源不存在时为 NOT_FOUND，其余来源失败按类别映射。
   */
  async function getRepositoryPullRequestDiff(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    number: number,
  ): Promise<{ patch: string; truncated: boolean }> {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.getPullRequestDiff) {
      throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取 PR 差异')
    }
    try {
      const diff = await adapter.getPullRequestDiff({ repository: repositoryRef(repository), number })
      return { patch: diff.patch, truncated: diff.truncated }
    } catch (error) {
      repositoryReadError(error)
    }
  }

  return {
    listProjectRepositories,
    listRepositoryBranches,
    listRepositoryTree,
    getRepositoryFile,
    getRepositoryFileAtRef: readRepositoryFileAtRef,
    listAvailableRepositories,
    linkRepository,
    unlinkRepository,
    createReference,
    refreshReference,
    removeReference,
    listReferences,
    listReferencesForTarget,
    listConnectionRepositories: listConnectionRepositoriesForActor,
    listRepositoryCommits,
    getRepositoryCommit,
    listRepositoryPullRequests,
    getRepositoryPullRequest,
    getRepositoryPullRequestDiff,
  }
}

export type CodeService = ReturnType<typeof createCodeService>
