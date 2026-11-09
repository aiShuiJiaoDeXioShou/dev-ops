import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.js'
import { ApiError } from '../../platform/http/errors.js'
import { ERROR_CODES } from '../../platform/http/error-codes.js'
import { appendActivity } from '../collaboration/public.js'
import {
  findActiveTeamMember,
  findUserById,
  requireTeamMember,
  type SessionUser,
  type TeamRole,
} from '../identity/public.js'
import {
  findProjectById,
  findProjectByName,
  findProjects,
  insertProject,
  lockProject,
  updateProject,
} from './projects.repository.js'

export type ProjectStatus = 'active' | 'paused' | 'ended'
const PROJECT_STATUSES = new Set<ProjectStatus>(['active', 'paused', 'ended'])

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
  owner: { userId: string; name: string }
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

function validateStatus(status: string): ProjectStatus {
  if (!PROJECT_STATUSES.has(status as ProjectStatus)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '项目状态不合法')
  return status as ProjectStatus
}

function validatePage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '分页参数不合法')
  }
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

  async function ownerName(userId: string): Promise<string> {
    return (await findUserById(db, userId))?.name ?? '未知用户'
  }

  async function toView(
    row: Awaited<ReturnType<typeof findProjectById>> & object,
    counts: ProjectCounts,
  ): Promise<ProjectView> {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      description: row.description,
      owner: { userId: row.owner_user_id, name: await ownerName(row.owner_user_id) },
      status: row.status as ProjectStatus,
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
    return membership.role as TeamRole
  }

  async function listProjects(
    actor: SessionUser,
    teamId: string,
    filters: { search?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<ProjectListResult> {
    await requireTeamMember(db, actor.id, teamId)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    validatePage(page, pageSize)
    if (filters.status !== undefined) validateStatus(filters.status)
    const { rows, total } = await findProjects(db, teamId, {
      search: filters.search?.trim() || undefined,
      status: filters.status,
      page,
      pageSize,
    })
    const counts = await countsFor(rows.map((row) => row.id))
    return {
      items: await Promise.all(
        rows.map((row) => toView(row, counts.get(row.id) ?? { openRequirements: 0, openBugs: 0 })),
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
    if (!(await findActiveTeamMember(db, teamId, ownerUserId))) {
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
    return toView(row, { openRequirements: 0, openBugs: 0 })
  }

  async function getProject(actor: SessionUser, projectId: string) {
    const row = await requireProjectAccess(actor, projectId)
    const counts = await countsFor([projectId])
    return toView(row, counts.get(projectId) ?? { openRequirements: 0, openBugs: 0 })
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
    if (input.ownerUserId !== undefined && !(await findActiveTeamMember(db, current.team_id, input.ownerUserId))) {
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
      await lockProject(tx, projectId)
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
    const counts = await countsFor([projectId])
    return toView(row, counts.get(projectId) ?? { openRequirements: 0, openBugs: 0 })
  }

  async function getStats(actor: SessionUser, projectId: string): Promise<ProjectCounts> {
    await requireProjectAccess(actor, projectId)
    const counts = await countsFor([projectId])
    return counts.get(projectId) ?? { openRequirements: 0, openBugs: 0 }
  }

  return { listProjects, createProject, getProject, updateProject: updateProjectDetails, getStats }
}

export type ProjectsService = ReturnType<typeof createProjectsService>
