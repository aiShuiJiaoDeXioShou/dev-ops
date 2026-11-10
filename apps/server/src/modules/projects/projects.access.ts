import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { findProjectContext, lockProject, type ProjectExecutor } from './projects.repository.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]

/** 项目上下文读模型：标识与所属团队，不暴露项目其他字段。 */
export interface ProjectContext {
  id: string
  teamId: string
}

/**
 * 读取项目上下文，供跨模块校验资源归属与团队权限。
 * @param executor 数据库连接或事务。
 * @param projectId 项目标识。
 * @returns 项目上下文；项目不存在时返回 undefined。
 */
export async function getProjectContext(
  executor: ProjectExecutor,
  projectId: string,
): Promise<ProjectContext | undefined> {
  return findProjectContext(executor, projectId)
}

/**
 * 在事务中锁定项目行并返回项目上下文，用于串行化项目内的编号分配与写入。
 * @param tx 事务连接。
 * @param projectId 项目标识。
 * @returns 项目上下文。
 * @throws 项目不存在时抛出 NOT_FOUND。
 */
export async function lockProjectForWrite(tx: TransactionDatabase, projectId: string): Promise<ProjectContext> {
  const row = await lockProject(tx, projectId)
  if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
  return { id: row.id, teamId: row.team_id }
}
