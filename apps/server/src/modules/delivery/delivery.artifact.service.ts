import type { Database } from '../../platform/database/client.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import type { RequireProjectAccess } from './delivery.access.ts'
import {
  findLatestProjectArtifacts,
  findProjectArtifacts,
  type ProjectArtifactFilters,
} from './delivery.artifact.repository.ts'
import { validateArtifactType, validateEnvironment } from './delivery.validators.ts'
import { pageView, toProjectArtifactView, type PageView, type ProjectArtifactView } from './delivery.view.ts'

/** 项目产物列表筛选；latest 为 true 时按服务＋环境＋类型返回最新一条。 */
export interface ArtifactListFilters {
  serviceId?: string
  environment?: string
  artifactType?: string
  latest: boolean
  page: number
  pageSize: number
}

export interface ArtifactUseCaseDeps {
  db: Database
  requireProject: RequireProjectAccess
}

/**
 * 创建项目产物查询用例。
 * @param deps 数据库连接与项目访问校验。
 * @returns 项目产物列表用例；浏览者只读，不提供写入口。
 */
export function createArtifactUseCases(deps: ArtifactUseCaseDeps) {
  const { db, requireProject } = deps

  /**
   * 按项目读取产物：最新模式返回每组最新一条，其他情况按采集时间倒序分页。
   * @param actor 当前登录用户。
   * @param projectId 项目标识。
   * @param filters 服务、环境、类型、最新模式与分页条件。
   * @returns 产物视图分页；无产物时为空列表与 0。
   * @throws 项目不存在或无团队权限时抛出 ApiError；筛选枚举不合法时抛出 VALIDATION_ERROR。
   */
  async function listProjectArtifacts(
    actor: SessionUser,
    projectId: string,
    filters: ArtifactListFilters,
  ): Promise<PageView<ProjectArtifactView>> {
    await requireProject(actor, projectId, false)
    validatePage(filters.page, filters.pageSize)
    const typedFilters: ProjectArtifactFilters = {
      serviceId: filters.serviceId,
      environment: filters.environment ? validateEnvironment(filters.environment) : undefined,
      artifactType: filters.artifactType ? validateArtifactType(filters.artifactType) : undefined,
    }
    if (filters.latest) {
      const rows = await findLatestProjectArtifacts(db, projectId, typedFilters)
      const items = rows.map(toProjectArtifactView)
      // 最新模式每组只返回一条，不做页码分页；仍复用统一分页结构以保持契约一致。
      return pageView(items, 1, filters.pageSize, items.length)
    }
    const { rows, total } = await findProjectArtifacts(db, projectId, typedFilters, filters.page, filters.pageSize)
    return pageView(rows.map(toProjectArtifactView), filters.page, filters.pageSize, total)
  }

  return { listProjectArtifacts }
}
