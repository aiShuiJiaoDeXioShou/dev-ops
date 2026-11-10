import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { findProjectServiceById } from '../projects/projects.repository.ts'

/** 项目上下文读模型：标识与所属团队，供权限校验使用。 */
export interface DeliveryProjectContext {
  id: string
  teamId: string
}

/**
 * 项目访问校验函数；写操作要求管理员或开发者，读操作允许浏览者。
 * @param actor 当前登录用户。
 * @param projectId 项目标识。
 * @param write 是否要求写权限。
 * @returns 项目上下文。
 * @throws 项目不存在时抛出 NOT_FOUND，无团队权限时抛出 FORBIDDEN。
 */
export type RequireProjectAccess = (
  actor: SessionUser,
  projectId: string,
  write: boolean,
) => Promise<DeliveryProjectContext>

/** 项目服务行；服务目录由 projects 模块独占写入，delivery 只读引用。 */
export type ProjectServiceRow = NonNullable<Awaited<ReturnType<typeof findProjectServiceById>>>

/**
 * 创建项目访问校验函数，统一 delivery 各用例的团队与角色校验。
 * @param db 数据库连接。
 * @returns 按项目归属与角色校验的访问函数。
 */
export function createProjectAccess(db: Database): RequireProjectAccess {
  return async (actor, projectId, write) => {
    const context = await getProjectContext(db, projectId)
    if (!context) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, context.teamId, write ? ['admin', 'developer'] : undefined)
    return context
  }
}

/**
 * 读取项目服务并校验归属；服务不存在或不属于项目时统一按不存在处理，避免泄露其他项目服务。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param serviceId 服务标识。
 * @returns 服务行。
 * @throws 服务不存在或不属于当前项目时抛出 NOT_FOUND。
 */
export async function requireProjectService(
  db: Database,
  projectId: string,
  serviceId: string,
): Promise<ProjectServiceRow> {
  const service = await findProjectServiceById(db, serviceId)
  if (!service || service.project_id !== projectId) throw new ApiError(ERROR_CODES.NOT_FOUND, '服务不存在')
  return service
}

/**
 * 校验服务仍可接收新的上报与确认；停用服务只保留历史只读。
 * @param service 服务行。
 * @returns 原服务行。
 * @throws 服务已停用时抛出 PRECONDITION_FAILED。
 */
export function requireActiveService(service: ProjectServiceRow): ProjectServiceRow {
  if (service.status !== 'active') throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '服务已停用，不能执行该操作')
  return service
}

/**
 * 读取项目服务并要求其处于启用状态，供新的上报/确认类写操作使用。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param serviceId 服务标识。
 * @returns 已启用的服务行。
 * @throws 服务不存在时抛出 NOT_FOUND，已停用时抛出 PRECONDITION_FAILED。
 */
export async function requireActiveProjectService(
  db: Database,
  projectId: string,
  serviceId: string,
): Promise<ProjectServiceRow> {
  return requireActiveService(await requireProjectService(db, projectId, serviceId))
}
