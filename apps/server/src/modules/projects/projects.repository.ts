import { and, count, desc, eq, ilike, notExists, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { project, projectService, projectServiceRepository } from './projects.tables.ts'
import { teamMember } from '../identity/identity.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type ProjectExecutor = Database | TransactionDatabase

export interface ProjectListFilters {
  search?: string
  status?: string
  ownerUnavailable?: boolean
  page: number
  pageSize: number
}

/** 按标识查找项目。 */
export async function findProjectById(db: Database, projectId: string) {
  const [row] = await db.select().from(project).where(eq(project.id, projectId)).limit(1)
  return row
}

/**
 * 读取项目上下文投影，仅返回标识与所属团队，供跨模块权限校验与归属判断使用。
 * @param executor 数据库连接或事务。
 * @param projectId 项目标识。
 * @returns 项目上下文投影或 undefined。
 */
export async function findProjectContext(executor: ProjectExecutor, projectId: string) {
  const [row] = await executor
    .select({ id: project.id, teamId: project.team_id })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  return row
}

/** 在事务中锁定项目行。 */
export async function lockProject(tx: TransactionDatabase, projectId: string) {
  const [row] = await tx.select().from(project).where(eq(project.id, projectId)).for('update')
  return row
}

/** 查找团队内同名项目。 */
export async function findProjectByName(db: Database, teamId: string, name: string) {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.team_id, teamId), eq(project.name, name)))
    .limit(1)
  return row
}

/**
 * 查询团队项目分页。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param filters 检索、状态、分页条件。
 * @returns 项目行与总数。
 */
export async function findProjects(db: Database, teamId: string, filters: ProjectListFilters) {
  const conditions = [eq(project.team_id, teamId)]
  if (filters.search) {
    const term = `%${filters.search}%`
    const searchCondition = or(ilike(project.name, term), ilike(project.description, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  if (filters.status) conditions.push(eq(project.status, filters.status))
  if (filters.ownerUnavailable) {
    conditions.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(teamMember)
          .where(
            and(
              eq(teamMember.team_id, project.team_id),
              eq(teamMember.user_id, project.owner_user_id),
              eq(teamMember.status, 'active'),
            ),
          ),
      ),
    )
  }
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(project)
      .where(where)
      .orderBy(desc(project.updated_at), desc(project.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(project).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 插入项目。 */
export async function insertProject(
  executor: ProjectExecutor,
  input: {
    id: string
    teamId: string
    name: string
    description: string | null
    ownerUserId: string
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(project)
    .values({
      id: input.id,
      team_id: input.teamId,
      name: input.name,
      description: input.description,
      owner_user_id: input.ownerUserId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('项目创建失败')
  return row
}

/**
 * 乐观锁更新项目。
 * @param tx 事务连接。
 * @param projectId 项目标识。
 * @param expectedVersion 当前版本。
 * @param values 待更新字段。
 * @returns 更新行；版本不匹配时返回 undefined。
 */
export async function updateProject(
  tx: TransactionDatabase,
  projectId: string,
  expectedVersion: number,
  values: {
    name?: string
    description?: string | null
    ownerUserId?: string
    status?: string
  },
) {
  const [row] = await tx
    .update(project)
    .set({
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.description === undefined ? {} : { description: values.description }),
      ...(values.ownerUserId === undefined ? {} : { owner_user_id: values.ownerUserId }),
      ...(values.status === undefined ? {} : { status: values.status }),
      version: sql`${project.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(project.id, projectId), eq(project.version, expectedVersion)))
    .returning()
  return row
}

/** 按标识查找项目服务。 */
export async function findProjectServiceById(db: Database, serviceId: string) {
  const [row] = await db.select().from(projectService).where(eq(projectService.id, serviceId)).limit(1)
  return row
}

/** 查询项目服务列表。 */
export async function findProjectServices(db: Database, projectId: string) {
  return db
    .select()
    .from(projectService)
    .where(eq(projectService.project_id, projectId))
    .orderBy(desc(projectService.updated_at), desc(projectService.id))
}

/** 按项目与名称查找服务。 */
export async function findProjectServiceByName(db: Database, projectId: string, name: string) {
  const [row] = await db
    .select({ id: projectService.id })
    .from(projectService)
    .where(and(eq(projectService.project_id, projectId), eq(projectService.name, name)))
    .limit(1)
  return row
}

/** 插入项目服务。 */
export async function insertProjectService(
  executor: ProjectExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    name: string
    description: string | null
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(projectService)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      name: input.name,
      description: input.description,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('项目服务写入失败')
  return row
}

/**
 * 按版本条件更新项目服务。
 * @returns 更新行；版本不匹配返回 undefined。
 */
export async function updateProjectService(
  executor: ProjectExecutor,
  serviceId: string,
  expectedVersion: number,
  fields: { name?: string; description?: string | null; status?: string },
) {
  const [row] = await executor
    .update(projectService)
    .set({
      ...(fields.name === undefined ? {} : { name: fields.name }),
      ...(fields.description === undefined ? {} : { description: fields.description }),
      ...(fields.status === undefined ? {} : { status: fields.status }),
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(and(eq(projectService.id, serviceId), eq(projectService.version, expectedVersion)))
    .returning()
  return row
}

/** 查询服务的仓库映射标识集合。 */
export async function findServiceRepositoryIds(db: Database, serviceId: string) {
  const rows = await db
    .select({ repositoryId: projectServiceRepository.repository_id })
    .from(projectServiceRepository)
    .where(eq(projectServiceRepository.service_id, serviceId))
  return new Set(rows.map((row) => row.repositoryId))
}

/** 插入服务与仓库映射。 */
export async function insertServiceRepository(
  executor: ProjectExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    serviceId: string
    repositoryId: string
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(projectServiceRepository)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      service_id: input.serviceId,
      repository_id: input.repositoryId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('服务仓库映射写入失败')
  return row
}

/** 删除服务与仓库映射；返回受影响行数。 */
export async function deleteServiceRepository(executor: ProjectExecutor, serviceId: string, repositoryId: string) {
  const rows = await executor
    .delete(projectServiceRepository)
    .where(
      and(eq(projectServiceRepository.service_id, serviceId), eq(projectServiceRepository.repository_id, repositoryId)),
    )
    .returning()
  return rows.length
}

/** 查询团队内全部服务仓库映射，供列表批量补齐。 */
export async function findServiceRepositoryLinks(db: Database, projectId: string) {
  return db.select().from(projectServiceRepository).where(eq(projectServiceRepository.project_id, projectId))
}
