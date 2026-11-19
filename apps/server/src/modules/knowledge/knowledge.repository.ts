import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import type { SkillFileStored } from './knowledge.types.ts'
import { skill, skillVersion } from './knowledge.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type KnowledgeExecutor = Database | TransactionDatabase

const skillColumns = {
  id: skill.id,
  teamId: skill.team_id,
  name: skill.name,
  identifier: skill.identifier,
  category: skill.category,
  summary: skill.summary,
  source: skill.source,
  enabled: skill.enabled,
  currentVersionId: skill.current_version_id,
  version: skill.version,
  createdByUserId: skill.created_by_user_id,
  createdAt: skill.created_at,
  updatedAt: skill.updated_at,
} as const

const skillVersionColumns = {
  id: skillVersion.id,
  teamId: skillVersion.team_id,
  skillId: skillVersion.skill_id,
  contentVersion: skillVersion.content_version,
  content: skillVersion.content,
  files: skillVersion.files,
  createdByUserId: skillVersion.created_by_user_id,
  createdAt: skillVersion.created_at,
  updatedAt: skillVersion.updated_at,
} as const

export interface SkillRow {
  id: string
  teamId: string
  name: string
  identifier: string
  category: string
  summary: string
  source: string
  enabled: boolean
  currentVersionId: string
  version: number
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface SkillVersionRow {
  id: string
  teamId: string
  skillId: string
  contentVersion: string
  content: string
  files: SkillFileStored[]
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface SkillListFilters {
  search?: string
  category?: string
  offset: number
  limit: number
}

export interface SkillListRecord {
  id: string
  name: string
  identifier: string
  category: string
  summary: string
  source: string
  enabled: boolean
  version: number
  updatedAt: Date
  contentVersion: string
}

export interface SkillDetailRecord extends SkillListRecord {
  teamId: string
  content: string
  files: SkillFileStored[]
  createdByUserId: string
  createdAt: Date
}

/**
 * 查询团队技能分页。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param filters 关键词、分类与分页条件。
 * @returns 技能列表记录与总数；只返回已存在当前内容版本的技能。
 */
export async function findSkills(db: Database, teamId: string, filters: SkillListFilters) {
  const conditions = [eq(skill.team_id, teamId)]
  if (filters.search) {
    const term = `%${filters.search}%`
    const search = or(ilike(skill.name, term), ilike(skill.identifier, term), ilike(skill.summary, term))
    if (search) conditions.push(search)
  }
  if (filters.category) conditions.push(eq(skill.category, filters.category))
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: skill.id,
        name: skill.name,
        identifier: skill.identifier,
        category: skill.category,
        summary: skill.summary,
        source: skill.source,
        enabled: skill.enabled,
        version: skill.version,
        updatedAt: skill.updated_at,
        contentVersion: skillVersion.content_version,
      })
      .from(skill)
      .innerJoin(skillVersion, eq(skill.current_version_id, skillVersion.id))
      .where(where)
      .orderBy(desc(skill.updated_at), desc(skill.id))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ value: count() }).from(skill).where(where),
  ])
  return { items: rows as SkillListRecord[], total: total?.value ?? 0 }
}

/**
 * 按标识读取技能当前元数据。
 * @param executor 数据库连接或事务。
 * @param skillId 技能标识。
 * @returns 技能行；不存在时返回 undefined。
 */
export async function findSkillById(executor: KnowledgeExecutor, skillId: string) {
  const [row] = await executor.select(skillColumns).from(skill).where(eq(skill.id, skillId)).limit(1)
  return row as SkillRow | undefined
}

/**
 * 在事务中锁定技能行，串行化编辑与启停。
 * @param tx 事务连接。
 * @param skillId 技能标识。
 * @returns 技能行；不存在时返回 undefined。
 */
export async function lockSkill(tx: TransactionDatabase, skillId: string) {
  const [row] = await tx.select(skillColumns).from(skill).where(eq(skill.id, skillId)).for('update')
  return row as SkillRow | undefined
}

/**
 * 读取技能详情与当前内容版本。
 * @param db 数据库连接。
 * @param skillId 技能标识。
 * @returns 详情记录；技能或当前版本缺失时返回 undefined。
 */
export async function findSkillDetail(db: Database, skillId: string) {
  const [row] = await db
    .select({
      id: skill.id,
      teamId: skill.team_id,
      name: skill.name,
      identifier: skill.identifier,
      category: skill.category,
      summary: skill.summary,
      source: skill.source,
      enabled: skill.enabled,
      version: skill.version,
      updatedAt: skill.updated_at,
      createdAt: skill.created_at,
      createdByUserId: skill.created_by_user_id,
      contentVersion: skillVersion.content_version,
      content: skillVersion.content,
      files: skillVersion.files,
    })
    .from(skill)
    .innerJoin(skillVersion, eq(skill.current_version_id, skillVersion.id))
    .where(eq(skill.id, skillId))
    .limit(1)
  return row as SkillDetailRecord | undefined
}

/**
 * 插入技能内容版本。
 * @param executor 数据库连接或事务。
 * @param input 版本标识、归属与正文。
 * @returns 新版本行。
 */
export async function insertSkillVersion(
  executor: KnowledgeExecutor,
  input: {
    id: string
    teamId: string
    skillId: string
    contentVersion: string
    content: string
    files: SkillFileStored[]
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(skillVersion)
    .values({
      id: input.id,
      team_id: input.teamId,
      skill_id: input.skillId,
      content_version: input.contentVersion,
      content: input.content,
      files: input.files,
      created_by_user_id: input.createdByUserId,
    })
    .returning(skillVersionColumns)
  if (!row) throw new Error('技能版本写入失败')
  return row as SkillVersionRow
}

/**
 * 插入技能记录。
 * @param tx 事务连接。
 * @param input 技能字段与当前版本标识。
 * @returns 新技能行。
 */
export async function insertSkill(
  tx: TransactionDatabase,
  input: {
    id: string
    teamId: string
    name: string
    identifier: string
    category: string
    summary: string
    currentVersionId: string
    createdByUserId: string
  },
) {
  const [row] = await tx
    .insert(skill)
    .values({
      id: input.id,
      team_id: input.teamId,
      name: input.name,
      identifier: input.identifier,
      category: input.category,
      summary: input.summary,
      current_version_id: input.currentVersionId,
      created_by_user_id: input.createdByUserId,
    })
    .returning(skillColumns)
  if (!row) throw new Error('技能写入失败')
  return row as SkillRow
}

/**
 * 乐观锁更新技能元数据与当前内容版本。
 * @param tx 事务连接。
 * @param skillId 技能标识。
 * @param expectedVersion 当前修订号。
 * @param values 待更新字段。
 * @returns 更新行；版本不匹配时返回 undefined。
 */
export async function updateSkill(
  tx: TransactionDatabase,
  skillId: string,
  expectedVersion: number,
  values: {
    name: string
    category: string
    summary: string
    currentVersionId: string
  },
) {
  const [row] = await tx
    .update(skill)
    .set({
      name: values.name,
      category: values.category,
      summary: values.summary,
      current_version_id: values.currentVersionId,
      version: sql`${skill.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(skill.id, skillId), eq(skill.version, expectedVersion)))
    .returning(skillColumns)
  return row as SkillRow | undefined
}

/**
 * 乐观锁设置技能启用状态。
 * @param tx 事务连接。
 * @param skillId 技能标识。
 * @param expectedVersion 当前修订号。
 * @param enabled 目标状态。
 * @returns 更新行；版本不匹配时返回 undefined。
 */
export async function setSkillEnabled(
  tx: TransactionDatabase,
  skillId: string,
  expectedVersion: number,
  enabled: boolean,
) {
  const [row] = await tx
    .update(skill)
    .set({ enabled, version: sql`${skill.version} + 1`, updated_at: new Date() })
    .where(and(eq(skill.id, skillId), eq(skill.version, expectedVersion)))
    .returning(skillColumns)
  return row as SkillRow | undefined
}

/**
 * 查询技能版本历史。
 * @param db 数据库连接。
 * @param skillId 技能标识。
 * @param page 页码。
 * @param pageSize 每页数量。
 * @returns 版本行与总数，按创建时间倒序。
 */
export async function findSkillVersions(db: Database, skillId: string, page: number, pageSize: number) {
  const where = eq(skillVersion.skill_id, skillId)
  const [rows, [total]] = await Promise.all([
    db
      .select(skillVersionColumns)
      .from(skillVersion)
      .where(where)
      .orderBy(desc(skillVersion.created_at), desc(skillVersion.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(skillVersion).where(where),
  ])
  return { items: rows as SkillVersionRow[], total: total?.value ?? 0 }
}

/**
 * 按标识读取技能内容版本。
 * @param executor 数据库连接或事务。
 * @param versionId 版本标识。
 * @returns 版本行；不存在时返回 undefined。
 */
export async function findSkillVersionById(executor: KnowledgeExecutor, versionId: string) {
  const [row] = await executor
    .select(skillVersionColumns)
    .from(skillVersion)
    .where(eq(skillVersion.id, versionId))
    .limit(1)
  return row as SkillVersionRow | undefined
}

/**
 * 按团队读取可配置给 Bot 的已启用技能。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @returns 技能候选，按最近更新时间倒序。
 */
export async function findAssignableSkills(db: Database, teamId: string) {
  return db
    .select({
      skillId: skill.id,
      name: skill.name,
      identifier: skill.identifier,
      category: skill.category,
      contentVersion: skillVersion.content_version,
    })
    .from(skill)
    .innerJoin(skillVersion, eq(skill.current_version_id, skillVersion.id))
    .where(and(eq(skill.team_id, teamId), eq(skill.enabled, true)))
    .orderBy(desc(skill.updated_at), desc(skill.id))
}

/**
 * 按标识批量读取技能，用于阶段 B 运行解析。
 * @param db 数据库连接。
 * @param skillIds 技能标识集合。
 * @returns 技能行；不存在或不属于同一团队的记录不返回。
 */
export async function findSkillsByIds(db: Database, skillIds: string[]) {
  if (skillIds.length === 0) return []
  return db.select(skillColumns).from(skill).where(inArray(skill.id, skillIds))
}

/**
 * 按团队与调用标识查找技能。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param identifier 调用标识。
 * @returns 技能标识；不存在时返回 undefined。
 */
export async function findSkillByIdentifier(db: Database, teamId: string, identifier: string) {
  const [row] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.team_id, teamId), eq(skill.identifier, identifier)))
    .limit(1)
  return row
}

/**
 * 查找技能是否已存在相同内容版本。
 * @param db 数据库连接。
 * @param skillId 技能标识。
 * @param contentVersion 内容版本。
 * @returns 版本标识；不存在时返回 undefined。
 */
export async function findSkillVersionByContentVersion(
  executor: KnowledgeExecutor,
  skillId: string,
  contentVersion: string,
) {
  const [row] = await executor
    .select({ id: skillVersion.id })
    .from(skillVersion)
    .where(and(eq(skillVersion.skill_id, skillId), eq(skillVersion.content_version, contentVersion)))
    .limit(1)
  return row
}

/**
 * 按标识批量读取技能内容版本，用于阶段 B 解析。
 * @param db 数据库连接。
 * @param versionIds 版本标识集合。
 * @returns 版本行；空集合直接返回空数组。
 */
export async function findSkillVersionsByIds(db: Database, versionIds: string[]) {
  if (versionIds.length === 0) return [] as SkillVersionRow[]
  const rows = await db.select(skillVersionColumns).from(skillVersion).where(inArray(skillVersion.id, versionIds))
  return rows as SkillVersionRow[]
}

/**
 * 统计团队已启用技能数量，供阶段 B 候选接口快速返回。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @returns 已启用技能数量。
 */
export async function countEnabledSkills(db: Database, teamId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(skill)
    .where(and(eq(skill.team_id, teamId), eq(skill.enabled, true)))
  return row?.value ?? 0
}
