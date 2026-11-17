import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, inArray, isNotNull, lte, notInArray, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { pipelineRun } from '../pipeline/pipeline.tables.ts'
import { PIPELINE_TERMINAL_RUN_STATUSES } from '../pipeline/pipeline.state.ts'
import { codeChange, toolInvocation } from '../tools/tools.tables.ts'
import { project } from './projects.tables.ts'
import { projectFileCleanup, projectPasswordLimit } from './projects.lifecycle.tables.ts'
import type { ProjectExecutor } from './projects.repository.ts'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const LEASE_MS = 5 * 60_000

/**
 * 锁定生命周期行，包括回收站中的项目。
 * @param tx 当前事务。
 * @param projectId 项目标识。
 * @returns 项目行或 undefined。
 */
export async function lockProjectLifecycle(tx: Transaction, projectId: string) {
  const [row] = await tx.select().from(project).where(eq(project.id, projectId)).for('update')
  return row
}

/**
 * 读取回收站分页及本次删除对应的文件清理状态。
 * @param db 数据库连接。
 * @param teamId 已授权团队。
 * @param page 页码。
 * @param pageSize 每页上限。
 * @returns 项目行和总数。
 */
export async function findDeletedProjects(db: Database, teamId: string, page: number, pageSize: number) {
  const where = and(eq(project.team_id, teamId), isNotNull(project.deleted_at))
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: project.id,
        name: project.name,
        version: project.version,
        deletedAt: project.deleted_at,
        cleanupStatus: projectFileCleanup.status,
      })
      .from(project)
      .leftJoin(
        projectFileCleanup,
        and(eq(projectFileCleanup.project_id, project.id), eq(projectFileCleanup.delete_version, project.version)),
      )
      .where(where)
      .orderBy(desc(project.deleted_at), desc(project.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(project).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/**
 * 在项目锁内定位尚未收口的执行；每类只查一条。
 * @param tx 已持有项目锁的事务。
 * @param projectId 项目标识。
 * @returns 阻止删除的工作类别。
 */
export async function findProjectDeletionBlockers(tx: Transaction, projectId: string) {
  const [active] = await tx
    .select({
      runs: sql<boolean>`exists (${tx
        .select({ id: pipelineRun.id })
        .from(pipelineRun)
        .where(
          and(
            eq(pipelineRun.project_id, projectId),
            notInArray(pipelineRun.status, [...PIPELINE_TERMINAL_RUN_STATUSES]),
          ),
        )})`,
      invocations: sql<boolean>`exists (${tx
        .select({ id: toolInvocation.id })
        .from(toolInvocation)
        .where(
          and(
            eq(toolInvocation.project_id, projectId),
            inArray(toolInvocation.status, ['queued', 'running', 'uncertain']),
          ),
        )})`,
      changes: sql<boolean>`exists (${tx
        .select({ id: codeChange.id })
        .from(codeChange)
        .where(and(eq(codeChange.project_id, projectId), inArray(codeChange.status, ['queued', 'running'])))})`,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  if (!active) throw new Error('数据库缺少已锁定的项目')
  return [...(active.runs ? ['流水线运行'] : []), ...(active.invocations || active.changes ? ['远端写操作'] : [])]
}

/**
 * 原子计入一次密码验证，所有 API 进程共用账号配额。
 * @param db 数据库连接。
 * @param userId 当前会话用户。
 * @returns 五分钟窗口内仍有配额时返回 true。
 */
export async function reserveProjectPasswordAttempt(db: Database, userId: string): Promise<boolean> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 5 * 60_000)
  const expired = lte(projectPasswordLimit.window_start, cutoff)
  const rows = await db
    .insert(projectPasswordLimit)
    .values({ id: userId, window_start: now, attempts: 1 })
    .onConflictDoUpdate({
      target: projectPasswordLimit.id,
      set: {
        window_start: sql`case when ${expired} then excluded.window_start else ${projectPasswordLimit.window_start} end`,
        attempts: sql`case when ${expired} then 1 else ${projectPasswordLimit.attempts} + 1 end`,
        updated_at: now,
      },
      setWhere: or(expired, sql`${projectPasswordLimit.attempts} < 10`),
    })
    .returning({ id: projectPasswordLimit.id })
  return rows.length === 1
}

/**
 * 读取某次删除的清理任务。
 * @param db 数据库连接或事务。
 * @param projectId 项目标识。
 * @param version 删除版本。
 * @returns 当前任务或 undefined。
 */
export async function findProjectFileCleanup(db: ProjectExecutor, projectId: string, version: number) {
  const [row] = await db
    .select()
    .from(projectFileCleanup)
    .where(and(eq(projectFileCleanup.project_id, projectId), eq(projectFileCleanup.delete_version, version)))
    .limit(1)
  return row
}

/**
 * 领取排队任务或接管过期租约。每次领取只处理一个有界批次。
 * @param db 数据库连接。
 * @param now 当前时间，测试可注入。
 * @returns 带租约令牌的任务，队列为空时为 undefined。
 */
export async function claimProjectFileCleanup(db: Database, now: Date) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(projectFileCleanup)
      .where(
        or(
          eq(projectFileCleanup.status, 'queued'),
          and(eq(projectFileCleanup.status, 'running'), lte(projectFileCleanup.lease_until, now)),
        ),
      )
      .orderBy(asc(projectFileCleanup.updated_at), asc(projectFileCleanup.id))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!job) return undefined
    const token = randomUUID()
    await tx
      .update(projectFileCleanup)
      .set({
        status: 'running',
        lease_token: token,
        lease_until: new Date(now.getTime() + LEASE_MS),
        updated_at: now,
      })
      .where(eq(projectFileCleanup.id, job.id))
    return { ...job, token }
  })
}

/**
 * 锁定仍由当前 Worker 持有的任务，用于保护进度更新和结果提交。
 * @param tx 当前事务。
 * @param id 清理任务标识。
 * @param token 本轮领取令牌。
 * @returns 当前租约仍有效时返回 true。
 */
export async function lockCleanupLease(tx: Transaction, id: string, token: string): Promise<boolean> {
  const [job] = await tx
    .select({ id: projectFileCleanup.id })
    .from(projectFileCleanup)
    .where(
      and(
        eq(projectFileCleanup.id, id),
        eq(projectFileCleanup.lease_token, token),
        sql`${projectFileCleanup.lease_until} > clock_timestamp()`,
      ),
    )
    .for('update')
  return Boolean(job)
}
