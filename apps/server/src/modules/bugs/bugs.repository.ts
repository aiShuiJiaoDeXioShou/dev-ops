import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { bug, bugRegression, bugRequirementLink } from './bugs.tables.ts'
import type { BugSummary, BugSummaryForRequirement } from './bugs.types.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type BugExecutor = Database | TransactionDatabase

/** Bug 完整行，供详情映射使用。 */
export type BugRow = NonNullable<Awaited<ReturnType<typeof findBugById>>>
/** Bug 列表投影行，仅包含列表需要的字段。 */
export type BugListRow = Awaited<ReturnType<typeof findBugs>>['rows'][number]
/** Bug 回归记录行。 */
export type RegressionRow = NonNullable<Awaited<ReturnType<typeof insertRegression>>>

export interface BugListFilters {
  search?: string
  status?: string
  ownerId?: string
  page: number
  pageSize: number
}

/** 按标识查找 Bug。 */
export async function findBugById(db: Database, bugId: string) {
  const [row] = await db.select().from(bug).where(eq(bug.id, bugId)).limit(1)
  return row
}

/** 按标识读取 Bug 摘要投影，供跨模块校验归属与展示关联，不返回正文。 */
export async function findBugSummaryById(executor: BugExecutor, bugId: string): Promise<BugSummary | undefined> {
  const [row] = await executor
    .select({
      id: bug.id,
      number: bug.number,
      title: bug.title,
      status: bug.status,
      projectId: bug.project_id,
      teamId: bug.team_id,
    })
    .from(bug)
    .where(eq(bug.id, bugId))
    .limit(1)
  return row
}

/** 在事务中锁定 Bug 行。 */
export async function lockBug(tx: TransactionDatabase, bugId: string) {
  const [row] = await tx.select().from(bug).where(eq(bug.id, bugId)).for('update')
  return row
}

/** 在事务中锁定项目后生成项目内 Bug 编号。 */
export async function nextBugNumber(tx: TransactionDatabase, projectId: string) {
  const [row] = await tx
    .select({ value: max(bug.number) })
    .from(bug)
    .where(eq(bug.project_id, projectId))
  return (row?.value ?? 0) + 1
}

/**
 * 查询项目 Bug 分页。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 搜索、状态、负责人、分页。
 * @returns 列表所需字段投影与总数；不返回现象、复现等大字段。
 */
export async function findBugs(db: Database, projectId: string, filters: BugListFilters) {
  const conditions = [eq(bug.project_id, projectId)]
  if (filters.search) {
    const term = `%${filters.search}%`
    const searchCondition = or(ilike(bug.title, term), ilike(sql`${bug.number}::text`, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  if (filters.status) conditions.push(eq(bug.status, filters.status))
  if (filters.ownerId) conditions.push(eq(bug.fix_owner_user_id, filters.ownerId))
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: bug.id,
        project_id: bug.project_id,
        number: bug.number,
        title: bug.title,
        status: bug.status,
        fix_owner_user_id: bug.fix_owner_user_id,
        regression_owner_user_id: bug.regression_owner_user_id,
        version: bug.version,
        updated_at: bug.updated_at,
      })
      .from(bug)
      .where(where)
      .orderBy(desc(bug.updated_at), desc(bug.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(bug).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 插入 Bug。 */
export async function insertBug(
  executor: BugExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    number: number
    title: string
    phenomenon: string
    expectedBehavior: string
    reproduction: string | null
    reproductionUnknown: boolean
    evidenceText: string | null
    evidenceUrl: string | null
    fixOwnerUserId: string | null
    regressionOwnerUserId: string | null
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(bug)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      number: input.number,
      title: input.title,
      phenomenon: input.phenomenon,
      expected_behavior: input.expectedBehavior,
      reproduction: input.reproduction,
      reproduction_unknown: input.reproductionUnknown,
      evidence_text: input.evidenceText,
      evidence_url: input.evidenceUrl,
      fix_owner_user_id: input.fixOwnerUserId,
      regression_owner_user_id: input.regressionOwnerUserId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('Bug 创建失败')
  return row
}

/** 条件更新 Bug 字段。 */
export async function updateBug(
  tx: TransactionDatabase,
  bugId: string,
  expectedVersion: number,
  values: {
    title?: string
    phenomenon?: string
    expectedBehavior?: string
    reproduction?: string | null
    reproductionUnknown?: boolean
    evidenceText?: string | null
    evidenceUrl?: string | null
    fixOwnerUserId?: string | null
    regressionOwnerUserId?: string | null
    status?: string
  },
) {
  const [row] = await tx
    .update(bug)
    .set({
      ...(values.title === undefined ? {} : { title: values.title }),
      ...(values.phenomenon === undefined ? {} : { phenomenon: values.phenomenon }),
      ...(values.expectedBehavior === undefined ? {} : { expected_behavior: values.expectedBehavior }),
      ...(values.reproduction === undefined ? {} : { reproduction: values.reproduction }),
      ...(values.reproductionUnknown === undefined ? {} : { reproduction_unknown: values.reproductionUnknown }),
      ...(values.evidenceText === undefined ? {} : { evidence_text: values.evidenceText }),
      ...(values.evidenceUrl === undefined ? {} : { evidence_url: values.evidenceUrl }),
      ...(values.fixOwnerUserId === undefined ? {} : { fix_owner_user_id: values.fixOwnerUserId }),
      ...(values.regressionOwnerUserId === undefined ? {} : { regression_owner_user_id: values.regressionOwnerUserId }),
      ...(values.status === undefined ? {} : { status: values.status }),
      version: sql`${bug.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(bug.id, bugId), eq(bug.version, expectedVersion)))
    .returning()
  return row
}

/** 查询 Bug 关联的需求标识。 */
export async function findBugRequirementIds(db: BugExecutor, bugId: string) {
  return db
    .select({ requirementId: bugRequirementLink.requirement_id })
    .from(bugRequirementLink)
    .where(eq(bugRequirementLink.bug_id, bugId))
}

/** 查询单条关联。 */
export async function findBugLink(db: BugExecutor, bugId: string, requirementId: string) {
  const [row] = await db
    .select({ id: bugRequirementLink.id })
    .from(bugRequirementLink)
    .where(and(eq(bugRequirementLink.bug_id, bugId), eq(bugRequirementLink.requirement_id, requirementId)))
    .limit(1)
  return row
}

/** 插入 Bug 需求关联。 */
export async function insertBugLink(
  executor: BugExecutor,
  input: { teamId: string; bugId: string; requirementId: string; createdByUserId: string },
) {
  await executor.insert(bugRequirementLink).values({
    id: randomUUID(),
    team_id: input.teamId,
    bug_id: input.bugId,
    requirement_id: input.requirementId,
    created_by_user_id: input.createdByUserId,
  })
}

/** 删除 Bug 需求关联。 */
export async function deleteBugLink(executor: BugExecutor, bugId: string, requirementId: string) {
  await executor
    .delete(bugRequirementLink)
    .where(and(eq(bugRequirementLink.bug_id, bugId), eq(bugRequirementLink.requirement_id, requirementId)))
}

/** 查询当前 pending 回归记录。 */
export async function findPendingRegression(executor: BugExecutor, bugId: string) {
  const [row] = await executor
    .select()
    .from(bugRegression)
    .where(and(eq(bugRegression.bug_id, bugId), eq(bugRegression.result, 'pending')))
    .limit(1)
  return row
}

/** 查询下一次回归轮次。 */
export async function nextRegressionAttempt(executor: BugExecutor, bugId: string) {
  const [row] = await executor
    .select({ value: max(bugRegression.attempt) })
    .from(bugRegression)
    .where(eq(bugRegression.bug_id, bugId))
  return (row?.value ?? 0) + 1
}

/** 插入回归记录。 */
export async function insertRegression(
  executor: BugExecutor,
  input: {
    id: string
    teamId: string
    bugId: string
    attempt: number
    fixSummary: string
    fixerUserId: string
    verifierUserId: string
  },
) {
  const [row] = await executor
    .insert(bugRegression)
    .values({
      id: input.id,
      team_id: input.teamId,
      bug_id: input.bugId,
      attempt: input.attempt,
      fix_summary: input.fixSummary,
      fixer_user_id: input.fixerUserId,
      verifier_user_id: input.verifierUserId,
    })
    .returning()
  if (!row) throw new Error('回归记录创建失败')
  return row
}

/** 更新回归记录结果。 */
export async function updateRegression(
  executor: BugExecutor,
  regressionId: string,
  values: {
    result: string
    failureReason?: string | null
    verifiedAt?: Date | null
  },
) {
  const [row] = await executor
    .update(bugRegression)
    .set({
      result: values.result,
      ...(values.failureReason === undefined ? {} : { failure_reason: values.failureReason }),
      ...(values.verifiedAt === undefined ? {} : { verified_at: values.verifiedAt }),
      updated_at: new Date(),
    })
    .where(eq(bugRegression.id, regressionId))
    .returning()
  return row
}

/** 查询 Bug 回归历史。 */
export async function listRegressions(db: BugExecutor, bugId: string) {
  return db.select().from(bugRegression).where(eq(bugRegression.bug_id, bugId)).orderBy(desc(bugRegression.attempt))
}

/** 按项目统计未解决且未关闭的 Bug 数量。 */
export async function countOpenBugsByProjects(db: Database, projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>()
  const rows = await db
    .select({ projectId: bug.project_id, value: count() })
    .from(bug)
    .where(and(inArray(bug.project_id, projectIds), sql`${bug.status} not in ('resolved', 'closed')`))
    .groupBy(bug.project_id)
  return new Map(rows.map((row) => [row.projectId, row.value]))
}

/**
 * 查询关联到指定需求的 Bug 摘要，供需求详情与测试通过资格判断。
 * @param db 数据库连接。
 * @param requirementId 需求标识。
 * @returns Bug 摘要数组。
 */
export async function findBugSummariesForRequirement(
  db: Database,
  requirementId: string,
): Promise<BugSummaryForRequirement[]> {
  return db
    .select({
      id: bug.id,
      number: bug.number,
      title: bug.title,
      status: bug.status,
    })
    .from(bugRequirementLink)
    .innerJoin(bug, eq(bug.id, bugRequirementLink.bug_id))
    .where(eq(bugRequirementLink.requirement_id, requirementId))
    .orderBy(bug.number)
}
