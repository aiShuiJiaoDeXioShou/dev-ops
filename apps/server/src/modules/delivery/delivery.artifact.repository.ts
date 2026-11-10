import { and, count, eq, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { buildArtifact, buildRecord } from './delivery.tables.ts'

/** 项目产物查询条件；均为等值筛选，缺省表示不限。 */
export interface ProjectArtifactFilters {
  serviceId?: string
  environment?: string
  artifactType?: string
}

/** 项目产物查询原始行：时间由 SQL 显式格式化为 UTC ISO 文本，便于跨驱动稳定解析。 */
type ProjectArtifactQueryRow = {
  id: string
  build_id: string
  artifact_type: string
  version_label: string
  access_url: string
  source: string
  collected_at: string
  status: string
  note: string | null
  service_id: string | null
  environment: string | null
  is_latest: boolean
}

/** 项目产物行：数据库列名加计算出的最新标记，映射由 view 层负责。 */
export type ProjectArtifactRecord = Omit<ProjectArtifactQueryRow, 'collected_at'> & {
  collected_at: Date
}

/**
 * 将查询行转换为业务行；时间不合法说明持久化异常，不伪装成用户输入错误。
 * @param row 原始查询行。
 * @returns 采集时间为 Date 的产物行。
 * @throws 数据库时间值不合法时抛出普通 Error。
 */
function toProjectArtifactRecord(row: ProjectArtifactQueryRow): ProjectArtifactRecord {
  const collectedAt = new Date(row.collected_at)
  if (Number.isNaN(collectedAt.getTime())) throw new Error(`数据库产物采集时间不合法: ${row.collected_at}`)
  return { ...row, collected_at: collectedAt }
}

/** 构造产物联表筛选条件；构建与产物都限定同一项目，避免不一致数据被当作归属。 */
function projectArtifactConditions(projectId: string, filters: ProjectArtifactFilters): SQL[] {
  const conditions: SQL[] = [eq(buildArtifact.project_id, projectId)]
  if (filters.serviceId) conditions.push(eq(buildRecord.service_id, filters.serviceId))
  if (filters.environment) conditions.push(eq(buildRecord.environment, filters.environment))
  if (filters.artifactType) conditions.push(eq(buildArtifact.artifact_type, filters.artifactType))
  return conditions
}

/** 构造带组内序号的项目产物查询；序号用于同时支持「最新」与「历史」两种读数。 */
function rankedProjectArtifactsQuery(projectId: string, filters: ProjectArtifactFilters) {
  return sql`
    select
      ranked.id,
      ranked.build_id,
      ranked.artifact_type,
      ranked.version_label,
      ranked.access_url,
      ranked.source,
      to_char(ranked.collected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as collected_at,
      ranked.status,
      ranked.note,
      ranked.service_id,
      ranked.environment,
      (ranked.latest_position = 1) as is_latest
    from (
      select
        ${buildArtifact.id} as id,
        ${buildArtifact.build_id} as build_id,
        ${buildArtifact.artifact_type} as artifact_type,
        ${buildArtifact.version_label} as version_label,
        ${buildArtifact.access_url} as access_url,
        ${buildArtifact.source} as source,
        ${buildArtifact.collected_at} as collected_at,
        ${buildArtifact.status} as status,
        ${buildArtifact.note} as note,
        ${buildRecord.service_id} as service_id,
        ${buildRecord.environment} as environment,
        row_number() over (
          partition by ${buildRecord.service_id}, ${buildRecord.environment}, ${buildArtifact.artifact_type}
          order by ${buildArtifact.collected_at} desc, ${buildArtifact.id} desc
        ) as latest_position
      from ${buildArtifact}
      inner join ${buildRecord}
        on ${buildRecord.id} = ${buildArtifact.build_id}
        and ${buildRecord.project_id} = ${buildArtifact.project_id}
      where ${sql.join(projectArtifactConditions(projectId, filters), sql` and `)}
    ) as ranked
  `
}

/**
 * 分页查询项目产物历史，并标记每组（服务＋环境＋类型）内最新一条。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 服务、环境、产物类型筛选。
 * @param page 页码，从 1 开始。
 * @param pageSize 每页数量。
 * @returns 产物行与总数；无产物时为空数组与 0。
 */
export async function findProjectArtifacts(
  db: Database,
  projectId: string,
  filters: ProjectArtifactFilters,
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize
  const [rows, [totalRow]] = await Promise.all([
    db.execute<ProjectArtifactQueryRow>(sql`
      ${rankedProjectArtifactsQuery(projectId, filters)}
      order by ranked.collected_at desc, ranked.id desc
      limit ${pageSize} offset ${offset}
    `),
    db
      .select({ value: count() })
      .from(buildArtifact)
      .innerJoin(
        buildRecord,
        and(eq(buildRecord.id, buildArtifact.build_id), eq(buildRecord.project_id, buildArtifact.project_id)),
      )
      .where(and(...projectArtifactConditions(projectId, filters))),
  ])
  return { rows: rows.rows.map(toProjectArtifactRecord), total: totalRow?.value ?? 0 }
}

/**
 * 查询项目内每组（服务＋环境＋类型）的最新产物。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @param filters 服务、环境、产物类型筛选。
 * @returns 最新产物行，按采集时间倒序；无产物时为空数组。
 */
export async function findLatestProjectArtifacts(db: Database, projectId: string, filters: ProjectArtifactFilters) {
  const result = await db.execute<ProjectArtifactQueryRow>(sql`
    ${rankedProjectArtifactsQuery(projectId, filters)}
    where ranked.latest_position = 1
    order by ranked.collected_at desc, ranked.id desc
  `)
  return result.rows.map(toProjectArtifactRecord)
}
