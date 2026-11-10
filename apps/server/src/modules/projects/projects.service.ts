import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { isActiveTeamMember } from '../identity/identity.repository.ts'
import { toTeamRole } from '../identity/identity.rules.ts'
import { loadOwnerRefs, ownerRefOf, type OwnerRef } from '../identity/identity.display.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { lockProjectForWrite } from './projects.access.ts'
import {
  deleteServiceRepository,
  findProjectById,
  findProjectByName,
  findProjectServiceById,
  findProjectServiceByName,
  findProjectServices,
  findProjects,
  findServiceRepositoryIds,
  findServiceRepositoryLinks,
  insertProject,
  insertProjectService,
  insertServiceRepository,
  updateProject,
  updateProjectService,
} from './projects.repository.ts'
import { findProjectRepositories, findProjectRepositoryLink } from '../code/code.repository.ts'

export type ProjectStatus = 'active' | 'paused' | 'ended'
const PROJECT_STATUSES: ReadonlySet<string> = new Set(['active', 'paused', 'ended'])

export interface ProjectCounts {
  openRequirements: number
  openBugs: number
}

export type ProjectCountsReader = (projectIds: string[]) => Promise<Map<string, ProjectCounts>>

export interface ProjectView {
  id: string
  teamId: string
  name: string
  description: string | null
  owner: OwnerRef
  status: ProjectStatus
  counts: ProjectCounts
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProjectListResult {
  items: ProjectView[]
  page: number
  pageSize: number
  total: number
}

export interface ProjectsServiceDeps {
  db: Database
  counts: ProjectCountsReader
}

function normalizeName(name: string): string {
  const value = name.trim()
  if (value.length === 0 || value.length > 120) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '项目名称长度必须在 1-120 个字符之间')
  }
  return value
}

function normalizeDescription(description: string | null | undefined): string | null {
  if (description === undefined || description === null) return null
  const value = description.trim()
  if (value.length > 2000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '项目说明不能超过 2000 个字符')
  return value.length === 0 ? null : value
}

/** 判断字符串是否为项目状态。 */
function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUSES.has(value)
}

function validateStatus(status: string): ProjectStatus {
  if (!isProjectStatus(status)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '项目状态不合法')
  return status
}

/** 将数据库项目状态收窄为业务类型；数据不合法时说明是持久化异常。 */
function toProjectStatus(value: string): ProjectStatus {
  if (!isProjectStatus(value)) throw new Error(`数据库项目状态不合法: ${value}`)
  return value
}

/** 服务仓库摘要视图。 */
export interface ServiceRepositoryView {
  repositoryId: string
  name: string
  namespace: string
  provider: string
  status: string
}

/** 项目服务视图。 */
export interface ServiceView {
  id: string
  projectId: string
  name: string
  description: string | null
  status: 'active' | 'disabled'
  repositories: ServiceRepositoryView[]
  latestBuild: { id: string; versionLabel: string; collectedAt: string; resultStatus: string } | null
  runVersions: Array<{
    environment: string
    versionLabel: string | null
    verificationStatus: string
    confirmedAt: string | null
  }>
  version: number
  createdAt: string
  updatedAt: string
}

/** 判断字符串是否为服务状态。 */
function isServiceStatus(value: string): value is 'active' | 'disabled' {
  return value === 'active' || value === 'disabled'
}

/** 将数据库服务状态收窄为业务类型；数据不合法时说明是持久化异常。 */
function toServiceStatus(value: string): 'active' | 'disabled' {
  if (!isServiceStatus(value)) throw new Error(`数据库服务状态不合法: ${value}`)
  return value
}

/** 判断唯一约束冲突；并发创建同名服务时映射为业务错误。 */
function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueConstraintError(error.cause)
}

function normalizeServiceName(name: string): string {
  const value = name.trim()
  if (value.length === 0 || value.length > 120) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '服务名称长度必须在 1-120 个字符之间')
  }
  return value
}

function normalizeServiceDescription(description: string | null | undefined): string | null {
  if (description === undefined || description === null) return null
  const value = description.trim()
  if (value.length > 2000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '服务说明不能超过 2000 个字符')
  return value.length === 0 ? null : value
}

/**
 * 创建项目服务。
 * @param deps 数据库与事项计数读取器；计数由需求/Bug 模块提供。
 * @returns 项目列表、详情、创建、更新与统计用例。
 */
export function createProjectsService(deps: ProjectsServiceDeps) {
  const { db } = deps

  async function countsFor(projectIds: string[]): Promise<Map<string, ProjectCounts>> {
    if (projectIds.length === 0) return new Map()
    const loaded = await deps.counts(projectIds)
    return new Map(projectIds.map((id) => [id, loaded.get(id) ?? { openRequirements: 0, openBugs: 0 }]))
  }

  async function ownerRefFor(teamId: string, userId: string): Promise<OwnerRef> {
    const refs = await loadOwnerRefs(db, teamId, [userId])
    return ownerRefOf(userId, refs) ?? { userId, name: '未知用户', status: 'missing', available: false }
  }

  function toView(
    row: Awaited<ReturnType<typeof findProjectById>> & object,
    counts: ProjectCounts,
    owner: OwnerRef,
  ): ProjectView {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      description: row.description,
      owner,
      status: toProjectStatus(row.status),
      counts,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  async function requireProjectAccess(actor: SessionUser, projectId: string) {
    const row = await findProjectById(db, projectId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, row.team_id)
    return row
  }

  async function requireWritableMember(actor: SessionUser, teamId: string): Promise<TeamRole> {
    const membership = await requireTeamMember(db, actor.id, teamId, ['admin', 'developer'])
    return toTeamRole(membership.role)
  }

  async function listProjects(
    actor: SessionUser,
    teamId: string,
    filters: {
      search?: string
      status?: string
      ownerUnavailable?: boolean
      page?: number
      pageSize?: number
    },
  ): Promise<ProjectListResult> {
    await requireTeamMember(db, actor.id, teamId)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    validatePage(page, pageSize)
    if (filters.status !== undefined) validateStatus(filters.status)
    const { rows, total } = await findProjects(db, teamId, {
      search: filters.search?.trim() || undefined,
      status: filters.status,
      ownerUnavailable: filters.ownerUnavailable,
      page,
      pageSize,
    })
    const counts = await countsFor(rows.map((row) => row.id))
    const ownerRefs = await loadOwnerRefs(
      db,
      teamId,
      rows.map((row) => row.owner_user_id),
    )
    return {
      items: rows.map((row) =>
        toView(
          row,
          counts.get(row.id) ?? { openRequirements: 0, openBugs: 0 },
          ownerRefOf(row.owner_user_id, ownerRefs) ?? {
            userId: row.owner_user_id,
            name: '未知用户',
            status: 'missing',
            available: false,
          },
        ),
      ),
      page,
      pageSize,
      total,
    }
  }

  async function createProject(
    actor: SessionUser,
    teamId: string,
    input: { name: string; description?: string | null; ownerUserId?: string },
  ) {
    await requireWritableMember(actor, teamId)
    const name = normalizeName(input.name)
    const description = normalizeDescription(input.description)
    const ownerUserId = input.ownerUserId ?? actor.id
    if (!(await isActiveTeamMember(db, teamId, ownerUserId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '项目负责人不是正常团队成员')
    }
    if (await findProjectByName(db, teamId, name)) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '同团队已存在同名项目')
    }
    const projectId = randomUUID()
    const row = await db.transaction(async (tx) => {
      const created = await insertProject(tx, {
        id: projectId,
        teamId,
        name,
        description,
        ownerUserId,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId,
        projectId,
        entityType: 'project',
        entityId: projectId,
        action: 'project_created',
        actorUserId: actor.id,
      })
      return created
    })
    return toView(row, { openRequirements: 0, openBugs: 0 }, await ownerRefFor(teamId, ownerUserId))
  }

  async function getProject(actor: SessionUser, projectId: string) {
    const row = await requireProjectAccess(actor, projectId)
    const [counts, owner] = await Promise.all([countsFor([projectId]), ownerRefFor(row.team_id, row.owner_user_id)])
    return toView(row, counts.get(projectId) ?? { openRequirements: 0, openBugs: 0 }, owner)
  }

  async function updateProjectDetails(
    actor: SessionUser,
    projectId: string,
    input: {
      version: number
      name?: string
      description?: string | null
      ownerUserId?: string
      status?: string
      statusReason?: string
    },
  ) {
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '版本参数不合法')
    }
    const current = await requireProjectAccess(actor, projectId)
    await requireWritableMember(actor, current.team_id)
    const name = input.name === undefined ? undefined : normalizeName(input.name)
    const description = input.description === undefined ? undefined : normalizeDescription(input.description)
    const status = input.status === undefined ? undefined : validateStatus(input.status)
    const statusReason = input.statusReason?.trim()
    if (status !== undefined && status !== current.status && !statusReason) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '变更项目状态必须填写原因')
    }
    if (input.ownerUserId !== undefined && !(await isActiveTeamMember(db, current.team_id, input.ownerUserId))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '项目负责人不是正常团队成员')
    }
    if (name !== undefined && name !== current.name && (await findProjectByName(db, current.team_id, name))) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '同团队已存在同名项目')
    }

    const changes: Record<string, unknown> = {}
    if (name !== undefined && name !== current.name) changes.name = [current.name, name]
    if (description !== undefined && description !== current.description)
      changes.description = [current.description, description]
    if (input.ownerUserId !== undefined && input.ownerUserId !== current.owner_user_id) {
      changes.owner = [current.owner_user_id, input.ownerUserId]
    }
    if (status !== undefined && status !== current.status) changes.status = [current.status, status]

    const row = await db.transaction(async (tx) => {
      await lockProjectForWrite(tx, projectId)
      const updated = await updateProject(tx, projectId, input.version, {
        name,
        description,
        ownerUserId: input.ownerUserId,
        status,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目已被更新，请刷新后重试')
      if (Object.keys(changes).length > 0) {
        await appendActivity(tx, {
          teamId: current.team_id,
          projectId,
          entityType: 'project',
          entityId: projectId,
          action: 'project_updated',
          actorUserId: actor.id,
          changes,
          ...(statusReason === undefined ? {} : { reason: statusReason }),
        })
      }
      return updated
    })
    const [counts, owner] = await Promise.all([countsFor([projectId]), ownerRefFor(row.team_id, row.owner_user_id)])
    return toView(row, counts.get(projectId) ?? { openRequirements: 0, openBugs: 0 }, owner)
  }

  async function getStats(actor: SessionUser, projectId: string): Promise<ProjectCounts> {
    await requireProjectAccess(actor, projectId)
    const counts = await countsFor([projectId])
    return counts.get(projectId) ?? { openRequirements: 0, openBugs: 0 }
  }

  async function requireServiceAccess(actor: SessionUser, serviceId: string, write: boolean) {
    const service = await findProjectServiceById(db, serviceId)
    if (!service) throw new ApiError(ERROR_CODES.NOT_FOUND, '服务不存在')
    await requireProjectAccess(actor, service.project_id)
    if (write) await requireWritableMember(actor, service.team_id)
    return service
  }

  async function serviceView(
    row: NonNullable<Awaited<ReturnType<typeof findProjectServiceById>>>,
  ): Promise<ServiceView> {
    const [links, repositoryRows] = await Promise.all([
      findServiceRepositoryIds(db, row.id),
      findProjectRepositories(db, row.project_id),
    ])
    const repositories = repositoryRows
      .filter((item) => links.has(item.repository.id))
      .map((item) => ({
        repositoryId: item.repository.id,
        name: item.repository.name,
        namespace: item.repository.namespace,
        provider: item.repository.provider_key,
        status: item.repository.status,
      }))
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      status: toServiceStatus(row.status),
      repositories,
      latestBuild: null,
      runVersions: [],
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  async function listServices(actor: SessionUser, projectId: string): Promise<ServiceView[]> {
    await requireProjectAccess(actor, projectId)
    const [rows, repositoryRows, links] = await Promise.all([
      findProjectServices(db, projectId),
      findProjectRepositories(db, projectId),
      findServiceRepositoryLinks(db, projectId),
    ])
    const repositoryById = new Map(repositoryRows.map((item) => [item.repository.id, item.repository]))
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      status: toServiceStatus(row.status),
      repositories: links
        .filter((link) => link.service_id === row.id)
        .flatMap((link) => {
          const repository = repositoryById.get(link.repository_id)
          return repository
            ? [
                {
                  repositoryId: repository.id,
                  name: repository.name,
                  namespace: repository.namespace,
                  provider: repository.provider_key,
                  status: repository.status,
                },
              ]
            : []
        }),
      latestBuild: null,
      runVersions: [],
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }))
  }

  async function getService(actor: SessionUser, serviceId: string): Promise<ServiceView> {
    const service = await requireServiceAccess(actor, serviceId, false)
    return serviceView(service)
  }

  async function validateServiceRepositories(projectId: string, repositoryIds: string[] | undefined) {
    const ids = repositoryIds ?? []
    for (const repositoryId of ids) {
      if (!(await findProjectRepositoryLink(db, projectId, repositoryId))) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '仓库尚未关联到当前项目')
      }
    }
    return [...new Set(ids)]
  }

  async function createService(
    actor: SessionUser,
    projectId: string,
    input: { name: string; description?: string | null; repositoryIds?: string[] },
  ): Promise<ServiceView> {
    const project = await requireProjectAccess(actor, projectId)
    await requireWritableMember(actor, project.team_id)
    const name = normalizeServiceName(input.name)
    if (await findProjectServiceByName(db, projectId, name)) {
      throw new ApiError(ERROR_CODES.SERVICE_NAME_DUPLICATE, '同项目已存在同名服务')
    }
    const repositoryIds = await validateServiceRepositories(projectId, input.repositoryIds)
    const serviceId = randomUUID()
    await db.transaction(async (tx) => {
      await insertProjectService(tx, {
        id: serviceId,
        teamId: project.team_id,
        projectId,
        name,
        description: normalizeServiceDescription(input.description),
        createdByUserId: actor.id,
      })
      for (const repositoryId of repositoryIds) {
        await insertServiceRepository(tx, {
          id: randomUUID(),
          teamId: project.team_id,
          projectId,
          serviceId,
          repositoryId,
          createdByUserId: actor.id,
        })
      }
      await appendActivity(tx, {
        teamId: project.team_id,
        projectId,
        entityType: 'project_service',
        entityId: serviceId,
        action: 'project_service_created',
        actorUserId: actor.id,
        changes: { name, repositoryIds },
      })
    })
    return getService(actor, serviceId)
  }

  async function updateServiceDetails(
    actor: SessionUser,
    serviceId: string,
    input: { version: number; name?: string; description?: string | null; status?: string },
  ): Promise<ServiceView> {
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '版本参数不合法')
    }
    const service = await requireServiceAccess(actor, serviceId, true)
    const name = input.name === undefined ? undefined : normalizeServiceName(input.name)
    const description = input.description === undefined ? undefined : normalizeServiceDescription(input.description)
    const status =
      input.status === undefined
        ? undefined
        : (() => {
            if (!isServiceStatus(input.status)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '服务状态不合法')
            return input.status
          })()
    if (name !== undefined && name !== service.name && (await findProjectServiceByName(db, service.project_id, name))) {
      throw new ApiError(ERROR_CODES.SERVICE_NAME_DUPLICATE, '同项目已存在同名服务')
    }
    const changes: Record<string, unknown> = {}
    if (name !== undefined && name !== service.name) changes.name = [service.name, name]
    if (description !== undefined && description !== service.description)
      changes.description = [service.description, description]
    if (status !== undefined && status !== service.status) changes.status = [service.status, status]
    await db.transaction(async (tx) => {
      const updated = await updateProjectService(tx, serviceId, input.version, { name, description, status })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '服务已被更新，请刷新后重试')
      if (Object.keys(changes).length > 0) {
        await appendActivity(tx, {
          teamId: service.team_id,
          projectId: service.project_id,
          entityType: 'project_service',
          entityId: serviceId,
          action: 'project_service_updated',
          actorUserId: actor.id,
          changes,
        })
      }
    })
    return getService(actor, serviceId)
  }

  async function addServiceRepository(
    actor: SessionUser,
    serviceId: string,
    repositoryId: string,
  ): Promise<ServiceView> {
    const service = await requireServiceAccess(actor, serviceId, true)
    if (!(await findProjectRepositoryLink(db, service.project_id, repositoryId))) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '仓库尚未关联到当前项目')
    }
    try {
      await db.transaction(async (tx) => {
        await insertServiceRepository(tx, {
          id: randomUUID(),
          teamId: service.team_id,
          projectId: service.project_id,
          serviceId,
          repositoryId,
          createdByUserId: actor.id,
        })
        await appendActivity(tx, {
          teamId: service.team_id,
          projectId: service.project_id,
          entityType: 'project_service',
          entityId: serviceId,
          action: 'project_service_repository_linked',
          actorUserId: actor.id,
          changes: { repositoryId },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '仓库已关联该服务')
      throw error
    }
    return getService(actor, serviceId)
  }

  async function removeServiceRepository(
    actor: SessionUser,
    serviceId: string,
    repositoryId: string,
    reason: string,
  ): Promise<ServiceView> {
    const service = await requireServiceAccess(actor, serviceId, true)
    const trimmedReason = reason.trim()
    if (trimmedReason.length === 0 || trimmedReason.length > 1000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '原因长度必须在 1-1000 个字符之间')
    }
    await db.transaction(async (tx) => {
      const removed = await deleteServiceRepository(tx, serviceId, repositoryId)
      if (removed === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '服务仓库映射不存在')
      await appendActivity(tx, {
        teamId: service.team_id,
        projectId: service.project_id,
        entityType: 'project_service',
        entityId: serviceId,
        action: 'project_service_repository_unlinked',
        actorUserId: actor.id,
        changes: { repositoryId },
        reason: trimmedReason,
      })
    })
    return getService(actor, serviceId)
  }

  return {
    listProjects,
    createProject,
    getProject,
    updateProject: updateProjectDetails,
    getStats,
    listServices,
    getService,
    createService,
    updateService: updateServiceDetails,
    addServiceRepository,
    removeServiceRepository,
  }
}

export type ProjectsService = ReturnType<typeof createProjectsService>
