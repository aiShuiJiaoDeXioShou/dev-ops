import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, ilike, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { codeReference, gitRepository, projectRepository } from './code.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type CodeExecutor = Database | TransactionDatabase

export interface RepositoryListFilters {
  search?: string
  page: number
  pageSize: number
}

/** 查询连接下仓库。 */
export async function findConnectionRepositories(db: Database, connectionId: string, filters: RepositoryListFilters) {
  const conditions = [eq(gitRepository.connection_id, connectionId)]
  if (filters.search) {
    const term = `%${filters.search}%`
    const searchCondition = or(ilike(gitRepository.namespace, term), ilike(gitRepository.name, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(gitRepository)
      .where(where)
      .orderBy(desc(gitRepository.name), desc(gitRepository.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(gitRepository).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 按标识查询仓库。 */
export async function findRepositoryById(db: Database, repositoryId: string) {
  const [row] = await db.select().from(gitRepository).where(eq(gitRepository.id, repositoryId)).limit(1)
  return row
}

/** 查询项目已关联仓库。 */
export async function findProjectRepositories(db: Database, projectId: string) {
  return db
    .select({ repository: gitRepository })
    .from(projectRepository)
    .innerJoin(gitRepository, eq(gitRepository.id, projectRepository.repository_id))
    .where(eq(projectRepository.project_id, projectId))
    .orderBy(desc(gitRepository.name))
}

/** 查询团队内可关联仓库。 */
export async function findAvailableRepositories(
  db: Database,
  teamId: string,
  connectionIds: string[],
  filters: RepositoryListFilters,
) {
  if (connectionIds.length === 0) return { rows: [], total: 0 }
  const conditions = [
    eq(gitRepository.team_id, teamId),
    eq(gitRepository.status, 'available'),
    inArray(gitRepository.connection_id, connectionIds),
  ]
  if (filters.search) {
    const term = `%${filters.search}%`
    const searchCondition = or(ilike(gitRepository.namespace, term), ilike(gitRepository.name, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(gitRepository)
      .where(where)
      .orderBy(desc(gitRepository.name), desc(gitRepository.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(gitRepository).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 查询项目仓库关联。 */
export async function findProjectRepositoryLink(db: Database, projectId: string, repositoryId: string) {
  const [row] = await db
    .select({ id: projectRepository.id })
    .from(projectRepository)
    .where(and(eq(projectRepository.project_id, projectId), eq(projectRepository.repository_id, repositoryId)))
    .limit(1)
  return row
}

/**
 * 查询项目已关联的仓库记录。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param repositoryId 仓库标识。
 * @returns 仓库记录；项目未关联该仓库时返回 undefined。
 * @remarks 一次 join 同时校验关联与仓库存在，代码读取前据此确认资源归属。
 */
export async function findLinkedRepository(db: Database, projectId: string, repositoryId: string) {
  const [row] = await db
    .select({ repository: gitRepository })
    .from(projectRepository)
    .innerJoin(gitRepository, eq(gitRepository.id, projectRepository.repository_id))
    .where(and(eq(projectRepository.project_id, projectId), eq(projectRepository.repository_id, repositoryId)))
    .limit(1)
  return row?.repository
}

/** 建立项目仓库关联。 */
export async function insertProjectRepository(
  db: CodeExecutor,
  input: { id: string; teamId: string; projectId: string; repositoryId: string; createdByUserId: string },
) {
  const [row] = await db
    .insert(projectRepository)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      repository_id: input.repositoryId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  return row
}

/** 删除项目仓库关联。 */
export async function deleteProjectRepository(db: CodeExecutor, projectId: string, repositoryId: string) {
  await db
    .delete(projectRepository)
    .where(and(eq(projectRepository.project_id, projectId), eq(projectRepository.repository_id, repositoryId)))
}

/** 插入代码引用。 */
export async function insertCodeReference(
  db: CodeExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    repositoryId: string
    targetType: string
    targetId: string
    objectType: string
    remoteId: string
    title: string | null
    state: string | null
    url: string | null
    createdByUserId: string
  },
) {
  const [row] = await db
    .insert(codeReference)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      repository_id: input.repositoryId,
      target_type: input.targetType,
      target_id: input.targetId,
      object_type: input.objectType,
      remote_id: input.remoteId,
      title_snapshot: input.title,
      state_snapshot: input.state,
      url: input.url,
      last_checked_at: new Date(),
      last_check_status: 'ok',
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  return row
}

/** 按标识查询代码引用。 */
export async function findCodeReferenceById(db: Database, codeReferenceId: string) {
  const [row] = await db.select().from(codeReference).where(eq(codeReference.id, codeReferenceId)).limit(1)
  return row
}

/** 查询项目内代码引用。 */
export async function findProjectCodeReferences(db: Database, projectId: string) {
  return db.select().from(codeReference).where(eq(codeReference.project_id, projectId))
}

/** 查询事项代码引用。 */
export async function findCodeReferencesForTarget(db: Database, targetType: string, targetId: string) {
  return db
    .select()
    .from(codeReference)
    .where(and(eq(codeReference.target_type, targetType), eq(codeReference.target_id, targetId)))
    .orderBy(desc(codeReference.created_at), desc(codeReference.id))
}

/**
 * 查询事项已关联的 PR 远端编号。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param repositoryId 仓库标识。
 * @param targetId 需求或 Bug 标识。
 * @returns 该事项在该仓库已关联的 change_request 远端编号；无关联时为空数组。
 * @remarks 同时限定项目与仓库，避免跨项目关联影响结果；不校验事项是否存在，
 * 由调用方把空集合解释为“没有匹配的 PR”而不是读取失败。
 */
export async function findChangeRequestRemoteIdsForTarget(
  db: Database,
  projectId: string,
  repositoryId: string,
  targetId: string,
): Promise<string[]> {
  const rows = await db
    .select({ remoteId: codeReference.remote_id })
    .from(codeReference)
    .where(
      and(
        eq(codeReference.project_id, projectId),
        eq(codeReference.repository_id, repositoryId),
        eq(codeReference.target_id, targetId),
        eq(codeReference.object_type, 'change_request'),
      ),
    )
  return rows.map((row) => row.remoteId)
}

/** 统计事项代码引用数量。 */
export async function countCodeReferencesForTarget(db: Database, targetType: string, targetId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(codeReference)
    .where(and(eq(codeReference.target_type, targetType), eq(codeReference.target_id, targetId)))
  return row?.value ?? 0
}

/** 删除代码引用。 */
export async function deleteCodeReference(db: CodeExecutor, codeReferenceId: string) {
  await db.delete(codeReference).where(eq(codeReference.id, codeReferenceId))
}

/** 更新引用核对结果。 */
export async function updateCodeReferenceCheck(
  db: CodeExecutor,
  codeReferenceId: string,
  values: {
    status: string
    errorCode: string | null
    title?: string | null
    state?: string | null
    url?: string | null
    checkedAt: Date
  },
) {
  const [row] = await db
    .update(codeReference)
    .set({
      last_check_status: values.status,
      last_error_code: values.errorCode,
      last_checked_at: values.checkedAt,
      ...(values.title === undefined ? {} : { title_snapshot: values.title }),
      ...(values.state === undefined ? {} : { state_snapshot: values.state }),
      ...(values.url === undefined ? {} : { url: values.url }),
      updated_at: new Date(),
    })
    .where(eq(codeReference.id, codeReferenceId))
    .returning()
  return row
}

/**
 * 同步连接下的仓库快照：新增或更新，未出现的仓库标记为 removed。
 * @param db 数据库连接。
 * @param input 团队、连接、提供方与远端仓库列表。
 * @returns 无返回值。
 */
export async function upsertGitRepositories(
  db: Database,
  input: {
    teamId: string
    connectionId: string
    providerKey: string
    repositories: Array<{
      remoteId: string
      namespace: string
      name: string
      webUrl: string
      defaultBranch: string | null
    }>
  },
): Promise<void> {
  for (const repository of input.repositories) {
    await db
      .insert(gitRepository)
      .values({
        id: randomUUID(),
        team_id: input.teamId,
        connection_id: input.connectionId,
        provider_key: input.providerKey,
        remote_repository_id: repository.remoteId,
        namespace: repository.namespace,
        name: repository.name,
        web_url: repository.webUrl,
        default_branch: repository.defaultBranch,
        status: 'available',
        last_synced_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [gitRepository.connection_id, gitRepository.remote_repository_id],
        set: {
          namespace: repository.namespace,
          name: repository.name,
          web_url: repository.webUrl,
          default_branch: repository.defaultBranch,
          status: 'available',
          last_synced_at: new Date(),
          updated_at: new Date(),
        },
      })
  }
  const remoteIds = input.repositories.map((item) => item.remoteId)
  const condition =
    remoteIds.length === 0
      ? eq(gitRepository.connection_id, input.connectionId)
      : and(
          eq(gitRepository.connection_id, input.connectionId),
          notInArray(gitRepository.remote_repository_id, remoteIds),
        )
  await db.update(gitRepository).set({ status: 'removed', updated_at: new Date() }).where(condition)
}

/** 将连接下仓库标记为不可用（撤权/失效）。 */
export async function markRepositoriesUnavailable(
  db: Database,
  connectionId: string,
  status: 'removed' | 'unavailable',
): Promise<void> {
  await db
    .update(gitRepository)
    .set({ status, updated_at: new Date() })
    .where(eq(gitRepository.connection_id, connectionId))
}
