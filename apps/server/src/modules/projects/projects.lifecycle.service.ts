import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { project } from './projects.tables.ts'
import { projectFileCleanup } from './projects.lifecycle.tables.ts'
import {
  findDeletedProjects,
  findProjectDeletionBlockers,
  findProjectFileCleanup,
  lockProjectLifecycle,
  reserveProjectPasswordAttempt,
} from './projects.lifecycle.repository.ts'
import { cleanupStatusOf } from './projects.lifecycle.view.ts'

type ProjectRow = typeof project.$inferSelect
type PasswordInput = { password: string; headers: IncomingHttpHeaders }

function requireVersion(row: ProjectRow, version: number) {
  if (row.version !== version) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目已更新，请刷新后重试')
}

async function requireLifecyclePermission(
  db: Pick<Database, 'select'>,
  actor: SessionUser,
  row: ProjectRow,
  allowOwner: boolean,
) {
  const member = await requireTeamMember(db, actor.id, row.team_id)
  if (member.role === 'admin' || (allowOwner && member.role === 'developer' && row.owner_user_id === actor.id)) return
  throw new ApiError(ERROR_CODES.FORBIDDEN, '无权管理该项目的回收站状态')
}

/**
 * 创建项目回收站用例。
 * @param db 数据库连接。
 * @param verifyPassword 当前登录会话的密码校验器；密码仅由其临时读取。
 * @returns 回收站列表、删除、恢复与文件清理请求。
 */
export function createProjectLifecycleService(
  db: Database,
  verifyPassword: (headers: IncomingHttpHeaders, password: string) => Promise<boolean>,
) {
  async function verifyAction(actor: SessionUser, projectId: string, input: PasswordInput, allowOwner: boolean) {
    const [row] = await db.select().from(project).where(eq(project.id, projectId)).limit(1)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireLifecyclePermission(db, actor, row, allowOwner)
    if (!(await reserveProjectPasswordAttempt(db, actor.id))) {
      throw new ApiError(ERROR_CODES.RATE_LIMITED, '密码验证过于频繁，请稍后再试')
    }
    if (!(await verifyPassword(input.headers, input.password))) {
      throw new ApiError(ERROR_CODES.PASSWORD_INVALID, '当前登录密码错误')
    }
  }

  /**
   * 分页读取团队管理员可见的回收站。
   * @param actor 当前用户。
   * @param teamId 团队标识。
   * @param page 页码。
   * @param pageSize 每页数量。
   * @returns 当前页、总数和本次删除的清理状态。
   * @throws 无团队管理员权限或分页参数不合法时抛出业务错误。
   */
  async function list(actor: SessionUser, teamId: string, page: number, pageSize: number) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    validatePage(page, pageSize)
    const { rows, total } = await findDeletedProjects(db, teamId, page, pageSize)
    return {
      items: rows.map((row) => {
        if (!row.deletedAt) throw new Error('数据库回收站项目删除时间不合法')
        return {
          id: row.id,
          name: row.name,
          version: row.version,
          deletedAt: row.deletedAt.toISOString(),
          cleanupStatus: cleanupStatusOf(row.cleanupStatus),
        }
      }),
      page,
      pageSize,
      total,
    }
  }

  /**
   * 校验本人密码并在项目锁内写入软删除和审计记录。
   * @param actor 当前用户。
   * @param projectId 项目标识。
   * @param version 页面读取的项目版本。
   * @param input 当前会话的请求头和本人密码。
   * @returns 移入回收站的项目 ID。
   * @throws 权限、密码、版本或未收口执行校验失败时抛出业务错误。
   */
  async function remove(actor: SessionUser, projectId: string, version: number, input: PasswordInput) {
    await verifyAction(actor, projectId, input, true)
    return db.transaction(async (tx) => {
      const row = await lockProjectLifecycle(tx, projectId)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
      await requireLifecyclePermission(tx, actor, row, true)
      if (row.deleted_at && row.version === version + 1) return { id: projectId }
      requireVersion(row, version)
      if (row.deleted_at) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '项目已在回收站')
      const blockers = await findProjectDeletionBlockers(tx, projectId)
      if (blockers.length) {
        throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, `请等待以下工作收口后重试：${blockers.join('、')}`, {
          blockers,
        })
      }
      const now = new Date()
      await tx
        .update(project)
        .set({
          deleted_at: now,
          deleted_by_user_id: actor.id,
          version: version + 1,
          updated_at: now,
        })
        .where(eq(project.id, projectId))
      await appendActivity(tx, {
        teamId: row.team_id,
        projectId,
        entityType: 'project',
        entityId: projectId,
        actorUserId: actor.id,
        action: 'project_deleted',
      })
      return { id: projectId }
    })
  }

  /**
   * 团队管理员恢复原项目，并记录活动。
   * @param actor 当前用户。
   * @param projectId 项目标识。
   * @param version 本次删除后的项目版本。
   * @returns 恢复的项目 ID。
   * @throws 版本变化、项目不在回收站或清理仍在进行时抛出业务错误。
   */
  async function restore(actor: SessionUser, projectId: string, version: number) {
    return db.transaction(async (tx) => {
      const row = await lockProjectLifecycle(tx, projectId)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
      await requireLifecyclePermission(tx, actor, row, false)
      requireVersion(row, version)
      if (!row.deleted_at) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '项目未移入回收站')
      const job = await findProjectFileCleanup(tx, projectId, version)
      if (job?.status === 'queued' || job?.status === 'running') {
        throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '请等待项目文件清理结束后再恢复')
      }
      await tx
        .update(project)
        .set({
          deleted_at: null,
          deleted_by_user_id: null,
          version: version + 1,
          updated_at: new Date(),
        })
        .where(eq(project.id, projectId))
      await appendActivity(tx, {
        teamId: row.team_id,
        projectId,
        entityType: 'project',
        entityId: projectId,
        actorUserId: actor.id,
        action: 'project_restored',
      })
      return { id: projectId }
    })
  }

  /**
   * 验证本人密码后提交清理任务，重试沿用已有任务及文件进度。
   * @param actor 当前用户。
   * @param projectId 项目标识。
   * @param version 本次删除后的项目版本。
   * @param input 当前会话的请求头和本人密码。
   * @returns 清理任务标识与当前状态。
   * @throws 权限、密码、版本或项目状态校验失败时抛出业务错误。
   */
  async function cleanup(actor: SessionUser, projectId: string, version: number, input: PasswordInput) {
    await verifyAction(actor, projectId, input, false)
    return db.transaction(async (tx) => {
      const row = await lockProjectLifecycle(tx, projectId)
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
      await requireLifecyclePermission(tx, actor, row, false)
      requireVersion(row, version)
      if (!row.deleted_at) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '仅可清理回收站中的项目文件')
      const job = await findProjectFileCleanup(tx, projectId, version)
      if (job && job.status !== 'failed') return { id: job.id, cleanupStatus: cleanupStatusOf(job.status) }
      const id = job?.id ?? randomUUID()
      const now = new Date()
      if (job) {
        await tx
          .update(projectFileCleanup)
          .set({ status: 'queued', requested_by_user_id: actor.id, updated_at: now })
          .where(eq(projectFileCleanup.id, id))
      } else {
        await tx.insert(projectFileCleanup).values({
          id,
          project_id: projectId,
          team_id: row.team_id,
          delete_version: version,
          requested_by_user_id: actor.id,
        })
      }
      await appendActivity(tx, {
        teamId: row.team_id,
        projectId,
        entityType: 'project',
        entityId: projectId,
        actorUserId: actor.id,
        action: 'project_file_cleanup_requested',
        changes: { jobId: id },
      })
      return { id, cleanupStatus: cleanupStatusOf('queued') }
    })
  }

  return { list, remove, restore, cleanup }
}
