import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { requirement, requirementCollaborator, requirementTestSubmission } from './requirements.tables.ts'
import type { RequirementSummary } from './requirements.types.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type RequirementExecutor = Database | TransactionDatabase

/** 需求完整行，供详情映射使用。 */
export type RequirementRow = NonNullable<Awaited<ReturnType<typeof findRequirementById>>>
/** 需求列表投影行，仅包含列表需要的字段。 */
export type RequirementListRow = Awaited<ReturnType<typeof findRequirements>>['rows'][number]
/** 需求提测记录行。 */
export type RequirementSubmissionRow = NonNullable<Awaited<ReturnType<typeof findLatestSubmission>>>

export interface RequirementListFilters {
  search?: string
  status?: string
  ownerId?: string
  page: number
  pageSize: number
}

/** 按标识查找需求。 */
export async function findRequirementById(db: Database, requirementId: string) {
  const [row] = await db.select().from(requirement).where(eq(requirement.id, requirementId)).limit(1)
  return row
}

/** 在事务中锁定需求行。 */
export async function lockRequirement(tx: TransactionDatabase, requirementId: string) {
  const [row] = await tx.select().from(requirement).where(eq(requirement.id, requirementId)).for('update')
  return row
}

/** 在事务中锁定项目行并返回当前最大需求编号。 */
export async function nextRequirementNumber(tx: TransactionDatabase, projectId: string) {
  const [row] = await tx
    .select({ value: max(requirement.number) })
    .from(requirement)
    .where(eq(requirement.project_id, projectId))
  return (row?.value ?? 0) + 1
}

/**
 * 查询项目需求分页。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 搜索、状态、负责人、分页。
 * @returns 列表所需字段投影与总数；不返回正文等大字段。
 */
export async function findRequirements(db: Database, projectId: string, filters: RequirementListFilters) {
  const conditions = [eq(requirement.project_id, projectId)]
  if (filters.search) {
    const term = `%${filters.search}%`
    const searchCondition = or(ilike(requirement.title, term), ilike(sql`${requirement.number}::text`, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  if (filters.status) conditions.push(eq(requirement.status, filters.status))
  if (filters.ownerId) conditions.push(eq(requirement.dev_owner_user_id, filters.ownerId))
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: requirement.id,
        project_id: requirement.project_id,
        number: requirement.number,
        title: requirement.title,
        status: requirement.status,
        dev_owner_user_id: requirement.dev_owner_user_id,
        test_owner_user_id: requirement.test_owner_user_id,
        version: requirement.version,
        updated_at: requirement.updated_at,
      })
      .from(requirement)
      .where(where)
      .orderBy(desc(requirement.updated_at), desc(requirement.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(requirement).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 插入需求。 */
export async function insertRequirement(
  executor: RequirementExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    number: number
    title: string
    contentMode: string
    contentMarkdown: string | null
    externalUrl: string | null
    externalSummary: string | null
    acceptanceCriteria: string | null
    devOwnerUserId: string | null
    testOwnerUserId: string | null
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(requirement)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      number: input.number,
      title: input.title,
      content_mode: input.contentMode,
      content_markdown: input.contentMarkdown,
      external_url: input.externalUrl,
      external_summary: input.externalSummary,
      acceptance_criteria: input.acceptanceCriteria,
      dev_owner_user_id: input.devOwnerUserId,
      test_owner_user_id: input.testOwnerUserId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('需求创建失败')
  return row
}

/**
 * 乐观锁更新需求。
 * @param tx 事务连接。
 * @param requirementId 需求标识。
 * @param expectedVersion 当前版本。
 * @param values 待更新字段。
 * @returns 更新行；版本不匹配时返回 undefined。
 */
export async function updateRequirement(
  tx: TransactionDatabase,
  requirementId: string,
  expectedVersion: number,
  values: {
    title?: string
    contentMode?: string
    contentMarkdown?: string | null
    externalUrl?: string | null
    externalSummary?: string | null
    acceptanceCriteria?: string | null
    devOwnerUserId?: string | null
    testOwnerUserId?: string | null
  },
) {
  const [row] = await tx
    .update(requirement)
    .set({
      ...(values.title === undefined ? {} : { title: values.title }),
      ...(values.contentMode === undefined ? {} : { content_mode: values.contentMode }),
      ...(values.contentMarkdown === undefined ? {} : { content_markdown: values.contentMarkdown }),
      ...(values.externalUrl === undefined ? {} : { external_url: values.externalUrl }),
      ...(values.externalSummary === undefined ? {} : { external_summary: values.externalSummary }),
      ...(values.acceptanceCriteria === undefined ? {} : { acceptance_criteria: values.acceptanceCriteria }),
      ...(values.devOwnerUserId === undefined ? {} : { dev_owner_user_id: values.devOwnerUserId }),
      ...(values.testOwnerUserId === undefined ? {} : { test_owner_user_id: values.testOwnerUserId }),
      version: sql`${requirement.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(requirement.id, requirementId), eq(requirement.version, expectedVersion)))
    .returning()
  return row
}

/** 查询需求的协作人员及姓名。 */
export async function findCollaborators(db: Database, requirementId: string) {
  return db
    .select({ userId: requirementCollaborator.user_id })
    .from(requirementCollaborator)
    .where(eq(requirementCollaborator.requirement_id, requirementId))
    .orderBy(requirementCollaborator.created_at, requirementCollaborator.user_id)
}

/** 替换需求协作人员集合。 */
export async function replaceCollaborators(
  tx: TransactionDatabase,
  requirementId: string,
  teamId: string,
  userIds: string[],
  createdByUserId: string,
) {
  await tx.delete(requirementCollaborator).where(eq(requirementCollaborator.requirement_id, requirementId))
  if (userIds.length === 0) return
  await tx.insert(requirementCollaborator).values(
    userIds.map((userId) => ({
      id: randomUUID(),
      team_id: teamId,
      requirement_id: requirementId,
      user_id: userId,
      created_by_user_id: createdByUserId,
    })),
  )
}

/** 按项目统计未测试通过且未取消的需求数量。 */
export async function countOpenRequirementsByProjects(db: Database, projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>()
  const rows = await db
    .select({ projectId: requirement.project_id, value: count() })
    .from(requirement)
    .where(and(inArray(requirement.project_id, projectIds), sql`${requirement.status} not in ('passed', 'cancelled')`))
    .groupBy(requirement.project_id)
  return new Map(rows.map((row) => [row.projectId, row.value]))
}

/**
 * 按标识批量读取需求摘要，供 Bug/流程模块展示关联；不返回正文。
 * @param executor 数据库连接或事务。
 * @param requirementIds 需求标识集合。
 * @returns 需求摘要数组，顺序与查询结果一致；空数组直接返回空数组。
 */
export async function findRequirementSummaries(
  executor: RequirementExecutor,
  requirementIds: string[],
): Promise<RequirementSummary[]> {
  if (requirementIds.length === 0) return []
  return executor
    .select({
      id: requirement.id,
      number: requirement.number,
      title: requirement.title,
      status: requirement.status,
      projectId: requirement.project_id,
      teamId: requirement.team_id,
    })
    .from(requirement)
    .where(inArray(requirement.id, [...new Set(requirementIds)]))
}

/**
 * 按标识读取单条需求摘要，供跨模块校验需求归属。
 * @param executor 数据库连接或事务。
 * @param requirementId 需求标识。
 * @returns 需求摘要；需求不存在时返回 undefined。
 */
export async function findRequirementSummaryById(
  executor: RequirementExecutor,
  requirementId: string,
): Promise<RequirementSummary | undefined> {
  const [summary] = await findRequirementSummaries(executor, [requirementId])
  return summary
}

/**
 * 在指定版本上更新需求状态与负责人；用于状态流转。
 * @param tx 事务连接。
 * @param requirementId 需求标识。
 * @param expectedVersion 当前版本。
 * @param values 状态与负责人。
 * @returns 更新行；版本不匹配返回 undefined。
 */
export async function updateRequirementState(
  tx: TransactionDatabase,
  requirementId: string,
  expectedVersion: number,
  values: {
    status?: string
    devOwnerUserId?: string | null
    testOwnerUserId?: string | null
  },
) {
  const [row] = await tx
    .update(requirement)
    .set({
      ...(values.status === undefined ? {} : { status: values.status }),
      ...(values.devOwnerUserId === undefined ? {} : { dev_owner_user_id: values.devOwnerUserId }),
      ...(values.testOwnerUserId === undefined ? {} : { test_owner_user_id: values.testOwnerUserId }),
      version: sql`${requirement.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(requirement.id, requirementId), eq(requirement.version, expectedVersion)))
    .returning()
  return row
}

/** 插入提测记录。 */
export async function insertTestSubmission(
  executor: RequirementExecutor,
  input: {
    id: string
    teamId: string
    requirementId: string
    submittedByUserId: string
    devOwnerUserId: string
    testOwnerUserId: string
    scopeNote: string
    selfTestResult: string
    selfTestNote: string | null
    testEntry: string | null
    versionNote: string | null
  },
) {
  const [row] = await executor
    .insert(requirementTestSubmission)
    .values({
      id: input.id,
      team_id: input.teamId,
      requirement_id: input.requirementId,
      submitted_by_user_id: input.submittedByUserId,
      dev_owner_user_id: input.devOwnerUserId,
      test_owner_user_id: input.testOwnerUserId,
      scope_note: input.scopeNote,
      self_test_result: input.selfTestResult,
      self_test_note: input.selfTestNote,
      test_entry: input.testEntry,
      version_note: input.versionNote,
    })
    .returning()
  if (!row) throw new Error('提测记录创建失败')
  return row
}

/** 查询需求最新提测记录。 */
export async function findLatestSubmission(db: Database, requirementId: string) {
  const [row] = await db
    .select()
    .from(requirementTestSubmission)
    .where(eq(requirementTestSubmission.requirement_id, requirementId))
    .orderBy(desc(requirementTestSubmission.created_at), desc(requirementTestSubmission.id))
    .limit(1)
  return row
}

/**
 * 分页查询需求提测历史。
 * @param db 数据库连接。
 * @param requirementId 需求标识。
 * @param page 页码。
 * @param pageSize 每页数量。
 * @returns 提测记录与总数。
 */
export async function findTestSubmissions(db: Database, requirementId: string, page: number, pageSize: number) {
  const where = eq(requirementTestSubmission.requirement_id, requirementId)
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(requirementTestSubmission)
      .where(where)
      .orderBy(desc(requirementTestSubmission.created_at), desc(requirementTestSubmission.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(requirementTestSubmission).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}
