import { and, count, desc, eq, gte, ilike, inArray, isNull, or } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { project } from '../projects/projects.tables.ts'
import { credential, credentialProjectGrant, credentialUsage, credentialVersion } from './configuration.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type CredentialExecutor = Database | TransactionDatabase

/** 凭据列表筛选与分页条件；开发者可见范围由服务层额外限制。 */
export interface CredentialListFilters {
  kind?: string
  status?: string
  search?: string
  page: number
  pageSize: number
}

/** 凭据使用记录筛选与分页条件；开发者只能查询已授权项目内的记录。 */
export interface CredentialUsageFilters {
  projectIds?: string[]
  page: number
  pageSize: number
}

/** 插入凭据元数据，密文由版本表保存。 */
export async function insertCredential(
  executor: CredentialExecutor,
  input: {
    id: string
    teamId: string
    name: string
    kind: string
    description: string | null
    expiresAt: Date | null
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(credential)
    .values({
      id: input.id,
      team_id: input.teamId,
      name: input.name,
      kind: input.kind,
      description: input.description,
      expires_at: input.expiresAt,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('凭据写入失败')
  return row
}

/** 按标识查找凭据元数据行；查询显式列出字段，不读取密文（密文不在本表）。 */
export async function findCredentialById(db: Database, credentialId: string) {
  const [row] = await db
    .select({
      id: credential.id,
      team_id: credential.team_id,
      name: credential.name,
      kind: credential.kind,
      description: credential.description,
      status: credential.status,
      current_version: credential.current_version,
      expires_at: credential.expires_at,
      created_by_user_id: credential.created_by_user_id,
      created_at: credential.created_at,
      updated_at: credential.updated_at,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  return row
}

/** 在事务中锁定凭据行，串行化轮换、撤销与授权变更。 */
export async function lockCredentialForUpdate(tx: TransactionDatabase, credentialId: string) {
  const [row] = await tx
    .select({
      id: credential.id,
      team_id: credential.team_id,
      name: credential.name,
      kind: credential.kind,
      description: credential.description,
      status: credential.status,
      current_version: credential.current_version,
      expires_at: credential.expires_at,
      created_by_user_id: credential.created_by_user_id,
      created_at: credential.created_at,
      updated_at: credential.updated_at,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .for('update')
    .limit(1)
  return row
}

/** 查找团队内同名凭据；唯一约束仍负责最终并发一致性。 */
export async function findCredentialByName(db: Database, teamId: string, name: string) {
  const [row] = await db
    .select({ id: credential.id })
    .from(credential)
    .where(and(eq(credential.team_id, teamId), eq(credential.name, name)))
    .limit(1)
  return row
}

/**
 * 分页查询团队凭据元数据。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param filters 分类、状态、检索与分页条件。
 * @param visibleCredentialIds 非空时只返回这些凭据（开发者仅被授权项目相关凭据）。
 * @returns 凭据行与总数；按更新时间倒序并用标识保证稳定顺序。
 */
export async function listCredentials(
  db: Database,
  teamId: string,
  filters: CredentialListFilters,
  visibleCredentialIds?: string[],
) {
  if (visibleCredentialIds !== undefined && visibleCredentialIds.length === 0) return { rows: [], total: 0 }
  const conditions = [eq(credential.team_id, teamId)]
  if (visibleCredentialIds !== undefined) conditions.push(inArray(credential.id, visibleCredentialIds))
  if (filters.kind) conditions.push(eq(credential.kind, filters.kind))
  if (filters.status) conditions.push(eq(credential.status, filters.status))
  if (filters.search) {
    const term = `%${filters.search}%`
    const searchCondition = or(ilike(credential.name, term), ilike(credential.description, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: credential.id,
        team_id: credential.team_id,
        name: credential.name,
        kind: credential.kind,
        description: credential.description,
        status: credential.status,
        current_version: credential.current_version,
        expires_at: credential.expires_at,
        created_by_user_id: credential.created_by_user_id,
        created_at: credential.created_at,
        updated_at: credential.updated_at,
      })
      .from(credential)
      .where(where)
      .orderBy(desc(credential.updated_at), desc(credential.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(credential).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/** 查询团队内存在有效项目授权的凭据标识，供开发者可见范围过滤。 */
export async function findActiveGrantedCredentialIds(db: Database, teamId: string) {
  const rows = await db
    .selectDistinct({ credentialId: credentialProjectGrant.credential_id })
    .from(credentialProjectGrant)
    .where(and(eq(credentialProjectGrant.team_id, teamId), isNull(credentialProjectGrant.revoked_at)))
  return rows.map((row) => row.credentialId)
}

/** 查询凭据当前有效的授权项目标识，供开发者使用记录范围过滤。 */
export async function findActiveGrantProjectIds(db: Database, credentialId: string) {
  const rows = await db
    .select({ projectId: credentialProjectGrant.project_id })
    .from(credentialProjectGrant)
    .where(and(eq(credentialProjectGrant.credential_id, credentialId), isNull(credentialProjectGrant.revoked_at)))
  return rows.map((row) => row.projectId)
}

/** 统计凭据当前有效授权数量，用于判断开发者可查看范围。 */
export async function countActiveGrants(db: Database, credentialId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(credentialProjectGrant)
    .where(and(eq(credentialProjectGrant.credential_id, credentialId), isNull(credentialProjectGrant.revoked_at)))
  return row?.value ?? 0
}

/** 条件更新凭据当前版本；版本不匹配时返回 undefined，由服务层报告冲突。 */
export async function updateCredentialCurrentVersion(
  tx: TransactionDatabase,
  credentialId: string,
  expectedCurrentVersion: number,
  values: { currentVersion: number },
) {
  const [row] = await tx
    .update(credential)
    .set({ current_version: values.currentVersion, updated_at: new Date() })
    .where(and(eq(credential.id, credentialId), eq(credential.current_version, expectedCurrentVersion)))
    .returning()
  return row
}

/** 条件更新凭据状态；只有仍处于期望状态时生效，防并发重复撤销。 */
export async function updateCredentialStatus(
  tx: TransactionDatabase,
  credentialId: string,
  expectedStatus: string,
  nextStatus: string,
) {
  const [row] = await tx
    .update(credential)
    .set({ status: nextStatus, updated_at: new Date() })
    .where(and(eq(credential.id, credentialId), eq(credential.status, expectedStatus)))
    .returning()
  return row
}

/** 插入凭据版本密文；唯一约束保证同一版本只写一次。 */
export async function insertCredentialVersion(
  executor: CredentialExecutor,
  input: {
    id: string
    teamId: string
    credentialId: string
    version: number
    ciphertext: string
    iv: string
    authTag: string
    keyVersion: number
    rotatedFromVersion: number | null
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(credentialVersion)
    .values({
      id: input.id,
      team_id: input.teamId,
      credential_id: input.credentialId,
      version: input.version,
      ciphertext: input.ciphertext,
      iv: input.iv,
      auth_tag: input.authTag,
      key_version: input.keyVersion,
      rotated_from_version: input.rotatedFromVersion,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('凭据版本写入失败')
  return row
}

/** 批量查询多个凭据的授权行，避免列表接口 N+1 查询。 */
export async function listGrantsForCredentials(db: Database, credentialIds: string[]) {
  if (credentialIds.length === 0) return []
  return db
    .select({
      credential_id: credentialProjectGrant.credential_id,
      project_id: credentialProjectGrant.project_id,
      expires_at: credentialProjectGrant.expires_at,
      revoked_at: credentialProjectGrant.revoked_at,
      created_at: credentialProjectGrant.created_at,
    })
    .from(credentialProjectGrant)
    .where(inArray(credentialProjectGrant.credential_id, credentialIds))
    .orderBy(credentialProjectGrant.created_at, credentialProjectGrant.id)
}

/** 查找凭据对指定项目的授权行（含已撤销）。 */
export async function findGrant(db: Database, credentialId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(credentialProjectGrant)
    .where(
      and(eq(credentialProjectGrant.credential_id, credentialId), eq(credentialProjectGrant.project_id, projectId)),
    )
    .limit(1)
  return row
}

/**
 * 写入或恢复项目授权：已存在行（含已撤销）复用并更新期限、授权人与撤销时间。
 * @returns 授权行。
 */
export async function upsertGrant(
  tx: TransactionDatabase,
  input: {
    id: string
    teamId: string
    credentialId: string
    projectId: string
    expiresAt: Date | null
    grantedByUserId: string
  },
) {
  const [row] = await tx
    .insert(credentialProjectGrant)
    .values({
      id: input.id,
      team_id: input.teamId,
      credential_id: input.credentialId,
      project_id: input.projectId,
      expires_at: input.expiresAt,
      granted_by_user_id: input.grantedByUserId,
    })
    .onConflictDoUpdate({
      target: [credentialProjectGrant.credential_id, credentialProjectGrant.project_id],
      set: {
        expires_at: input.expiresAt,
        granted_by_user_id: input.grantedByUserId,
        revoked_at: null,
        updated_at: new Date(),
      },
    })
    .returning()
  if (!row) throw new Error('凭据授权写入失败')
  return row
}

/** 撤销有效项目授权；已撤销或不存在时返回 undefined。 */
export async function revokeGrant(tx: TransactionDatabase, credentialId: string, projectId: string) {
  const [row] = await tx
    .update(credentialProjectGrant)
    .set({ revoked_at: new Date(), updated_at: new Date() })
    .where(
      and(
        eq(credentialProjectGrant.credential_id, credentialId),
        eq(credentialProjectGrant.project_id, projectId),
        isNull(credentialProjectGrant.revoked_at),
      ),
    )
    .returning()
  return row
}

/** 查询项目展示信息（名称与所属团队），用于授权视图与跨团队校验。 */
export async function findProjectRefById(db: Database, projectId: string) {
  const [row] = await db
    .select({ id: project.id, name: project.name, teamId: project.team_id })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  return row
}

/** 批量查询项目展示信息，避免授权列表逐条查询项目。 */
export async function findProjectRefsByIds(db: Database, projectIds: string[]) {
  if (projectIds.length === 0) return []
  return db
    .select({ id: project.id, name: project.name, teamId: project.team_id })
    .from(project)
    .where(inArray(project.id, projectIds))
}

/** 插入使用/管理动作审计记录；调用方保证不传入密钥值。 */
export async function insertCredentialUsage(
  executor: CredentialExecutor,
  input: {
    id: string
    teamId: string
    credentialId: string
    credentialVersion: number
    projectId: string | null
    environment: string | null
    action: string
    actorUserId: string | null
    result: string
    errorCode: string | null
  },
) {
  const [row] = await executor
    .insert(credentialUsage)
    .values({
      id: input.id,
      team_id: input.teamId,
      credential_id: input.credentialId,
      credential_version: input.credentialVersion,
      project_id: input.projectId,
      environment: input.environment,
      action: input.action,
      actor_user_id: input.actorUserId,
      result: input.result,
      error_code: input.errorCode,
    })
    .returning()
  if (!row) throw new Error('凭据使用记录写入失败')
  return row
}

/**
 * 分页查询凭据使用记录。
 * @param db 数据库连接。
 * @param credentialId 凭据标识。
 * @param filters 项目范围与分页条件；projectIds 非空时只返回这些项目（以及无项目的管理动作不返回）。
 * @returns 使用记录行与总数。
 */
export async function listCredentialUsage(db: Database, credentialId: string, filters: CredentialUsageFilters) {
  if (filters.projectIds !== undefined && filters.projectIds.length === 0) return { rows: [], total: 0 }
  const conditions = [eq(credentialUsage.credential_id, credentialId)]
  if (filters.projectIds !== undefined) conditions.push(inArray(credentialUsage.project_id, filters.projectIds))
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: credentialUsage.id,
        credential_id: credentialUsage.credential_id,
        credential_version: credentialUsage.credential_version,
        project_id: credentialUsage.project_id,
        environment: credentialUsage.environment,
        action: credentialUsage.action,
        actor_user_id: credentialUsage.actor_user_id,
        result: credentialUsage.result,
        error_code: credentialUsage.error_code,
        created_at: credentialUsage.created_at,
      })
      .from(credentialUsage)
      .where(where)
      .orderBy(desc(credentialUsage.created_at), desc(credentialUsage.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(credentialUsage).where(where),
  ])
  return { rows, total: total?.value ?? 0 }
}

/**
 * 按凭据与版本号读取该版本的密文材料。
 * @param db 数据库连接。
 * @param credentialId 凭据标识。
 * @param version 凭据版本号。
 * @returns 当前版本的密文、初始化向量、认证标签与密钥版本；不存在时返回 null。
 * @remarks 仅供服务端解密使用，不得把返回值放入接口响应或日志。
 */
export async function findCredentialVersionCiphertext(db: Database, credentialId: string, version: number) {
  const [row] = await db
    .select({
      ciphertext: credentialVersion.ciphertext,
      iv: credentialVersion.iv,
      auth_tag: credentialVersion.auth_tag,
      key_version: credentialVersion.key_version,
    })
    .from(credentialVersion)
    .where(and(eq(credentialVersion.credential_id, credentialId), eq(credentialVersion.version, version)))
    .limit(1)
  return row ?? null
}

/**
 * 统计指定用户在时间窗内的明文查看尝试次数，供二次验证限流。
 * @param db 数据库连接。
 * @param actorUserId 发起查看的用户标识。
 * @param since 统计起点，包含该时间之后写入的尝试记录。
 * @returns 成功与失败的明文查看尝试总数。
 */
export async function countRecentCredentialRevealAttempts(db: Database, actorUserId: string, since: Date) {
  const [row] = await db
    .select({ value: count() })
    .from(credentialUsage)
    .where(
      and(
        eq(credentialUsage.actor_user_id, actorUserId),
        eq(credentialUsage.action, 'reveal'),
        gte(credentialUsage.created_at, since),
      ),
    )
  return row?.value ?? 0
}

/** 查询凭据最近使用记录，供详情页展示使用摘要。 */
export async function listRecentCredentialUsage(db: Database, credentialId: string, limit: number) {
  return db
    .select({
      id: credentialUsage.id,
      credential_id: credentialUsage.credential_id,
      credential_version: credentialUsage.credential_version,
      project_id: credentialUsage.project_id,
      environment: credentialUsage.environment,
      action: credentialUsage.action,
      actor_user_id: credentialUsage.actor_user_id,
      result: credentialUsage.result,
      error_code: credentialUsage.error_code,
      created_at: credentialUsage.created_at,
    })
    .from(credentialUsage)
    .where(eq(credentialUsage.credential_id, credentialId))
    .orderBy(desc(credentialUsage.created_at), desc(credentialUsage.id))
    .limit(limit)
}
