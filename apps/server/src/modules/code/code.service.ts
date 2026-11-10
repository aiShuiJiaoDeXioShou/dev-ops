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
  findCodeReferenceById,
  findCodeReferencesForTarget,
  findConnectionRepositories,
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
    const link = await findProjectRepositoryLink(db, projectId, repositoryId)
    const repository = await findRepositoryById(db, repositoryId)
    if (!link || !repository || repository.team_id !== project.teamId) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '项目仓库关联不存在')
    }
    const connectionIds = await deps.listActiveConnectionIds(project.teamId)
    if (!connectionIds.includes(repository.connection_id)) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, 'Git 连接不可用')
    }
    return { project, repository, adapter: await deps.resolveAdapter(repository.connection_id) }
  }

  function repositoryReadError(error: unknown): never {
    const code =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth_failed'
        ? ERROR_CODES.EXTERNAL_AUTH_FAILED
        : ERROR_CODES.EXTERNAL_UNAVAILABLE
    throw new ApiError(code, '读取远端仓库失败，请检查连接状态后重试')
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

  async function getRepositoryFile(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { branch?: string; path: string },
  ) {
    const { repository, adapter } = await requireLinkedRepository(actor, projectId, repositoryId)
    if (!adapter.getFile) throw new ApiError(ERROR_CODES.EXTERNAL_UNSUPPORTED, '当前 Git 适配器不支持读取文件')
    const ref = (input.branch?.trim() || repository.default_branch || '').trim()
    if (!ref) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仓库没有可用分支')
    const path = input.path.trim().replace(/^\/+/, '')
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

  return {
    listProjectRepositories,
    listRepositoryTree,
    getRepositoryFile,
    listAvailableRepositories,
    linkRepository,
    unlinkRepository,
    createReference,
    refreshReference,
    removeReference,
    listReferences,
    listReferencesForTarget,
    listConnectionRepositories: listConnectionRepositoriesForActor,
  }
}

export type CodeService = ReturnType<typeof createCodeService>
