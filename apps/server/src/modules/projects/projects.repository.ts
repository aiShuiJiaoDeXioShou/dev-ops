import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { project } from './projects.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type ProjectExecutor = Database | TransactionDatabase

export interface ProjectListFilters {
  search?: string
  status?: string
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
