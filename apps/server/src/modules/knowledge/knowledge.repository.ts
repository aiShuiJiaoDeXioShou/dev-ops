import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import {
  agentTemplate,
  agentTemplateVersion,
  projectTemplateSelection,
  skill,
  skillVersion,
  templateSnapshotLink,
} from './knowledge.tables.ts'

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
  createdByUserId: skillVersion.created_by_user_id,
  createdAt: skillVersion.created_at,
  updatedAt: skillVersion.updated_at,
} as const

const templateColumns = {
  id: agentTemplate.id,
  teamId: agentTemplate.team_id,
  name: agentTemplate.name,
  nameNormalized: agentTemplate.name_normalized,
  tag: agentTemplate.tag,
  description: agentTemplate.description,
  currentVersionId: agentTemplate.current_version_id,
  version: agentTemplate.version,
  createdByUserId: agentTemplate.created_by_user_id,
  createdAt: agentTemplate.created_at,
  updatedAt: agentTemplate.updated_at,
} as const

const templateVersionColumns = {
  id: agentTemplateVersion.id,
  teamId: agentTemplateVersion.team_id,
  templateId: agentTemplateVersion.template_id,
  version: agentTemplateVersion.version,
  content: agentTemplateVersion.content,
  createdByUserId: agentTemplateVersion.created_by_user_id,
  createdAt: agentTemplateVersion.created_at,
  updatedAt: agentTemplateVersion.updated_at,
} as const

const selectionColumns = {
  id: projectTemplateSelection.id,
  teamId: projectTemplateSelection.team_id,
  projectId: projectTemplateSelection.project_id,
  templateId: projectTemplateSelection.template_id,
  selectedByUserId: projectTemplateSelection.selected_by_user_id,
  version: projectTemplateSelection.version,
  createdAt: projectTemplateSelection.created_at,
  updatedAt: projectTemplateSelection.updated_at,
} as const

const snapshotLinkColumns = {
  id: templateSnapshotLink.id,
  teamId: templateSnapshotLink.team_id,
  templateId: templateSnapshotLink.template_id,
  templateVersionId: templateSnapshotLink.template_version_id,
  token: templateSnapshotLink.token,
  createdByUserId: templateSnapshotLink.created_by_user_id,
  createdAt: templateSnapshotLink.created_at,
  updatedAt: templateSnapshotLink.updated_at,
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
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface TemplateRow {
  id: string
  teamId: string
  name: string
  nameNormalized: string
  tag: string
  description: string | null
  currentVersionId: string
  version: number
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface TemplateVersionRow {
  id: string
  teamId: string
  templateId: string
  version: number
  content: string
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface SelectionRow {
  id: string
  teamId: string
  projectId: string
  templateId: string
  selectedByUserId: string
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface SnapshotLinkRow {
  id: string
  teamId: string
  templateId: string
  templateVersionId: string
  token: string
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface SkillListFilters {
  search?: string
  category?: string
  page: number
  pageSize: number
}

export interface TemplateListFilters {
  search?: string
  tag?: string
  page: number
  pageSize: number
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
  createdByUserId: string
  createdAt: Date
}

export interface TemplateListRecord {
  id: string
  name: string
  tag: string
  description: string | null
  version: number
  updatedAt: Date
  contentVersion: number
}

export interface TemplateDetailRecord extends TemplateListRecord {
  teamId: string
  content: string
  createdByUserId: string
  createdAt: Date
}

export interface SelectionDetailRecord {
  selection: SelectionRow
  templateName: string
  contentVersion: number
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
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
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
 * 查询团队模板分页。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param filters 关键词、标签与分页条件。
 * @returns 模板列表记录与总数。
 */
export async function findTemplates(db: Database, teamId: string, filters: TemplateListFilters) {
  const conditions = [eq(agentTemplate.team_id, teamId)]
  if (filters.search) {
    const term = `%${filters.search}%`
    const search = or(ilike(agentTemplate.name, term), ilike(agentTemplate.tag, term))
    if (search) conditions.push(search)
  }
  if (filters.tag) conditions.push(eq(agentTemplate.tag, filters.tag))
  const where = and(...conditions)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: agentTemplate.id,
        name: agentTemplate.name,
        tag: agentTemplate.tag,
        description: agentTemplate.description,
        version: agentTemplate.version,
        updatedAt: agentTemplate.updated_at,
        contentVersion: agentTemplateVersion.version,
      })
      .from(agentTemplate)
      .innerJoin(agentTemplateVersion, eq(agentTemplate.current_version_id, agentTemplateVersion.id))
      .where(where)
      .orderBy(desc(agentTemplate.updated_at), desc(agentTemplate.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ value: count() }).from(agentTemplate).where(where),
  ])
  return { items: rows as TemplateListRecord[], total: total?.value ?? 0 }
}

/**
 * 按标识读取模板当前元数据。
 * @param executor 数据库连接或事务。
 * @param templateId 模板标识。
 * @returns 模板行；不存在时返回 undefined。
 */
export async function findTemplateById(executor: KnowledgeExecutor, templateId: string) {
  const [row] = await executor
    .select(templateColumns)
    .from(agentTemplate)
    .where(eq(agentTemplate.id, templateId))
    .limit(1)
  return row as TemplateRow | undefined
}

/**
 * 在事务中锁定模板行。
 * @param tx 事务连接。
 * @param templateId 模板标识。
 * @returns 模板行；不存在时返回 undefined。
 */
export async function lockTemplate(tx: TransactionDatabase, templateId: string) {
  const [row] = await tx
    .select(templateColumns)
    .from(agentTemplate)
    .where(eq(agentTemplate.id, templateId))
    .for('update')
  return row as TemplateRow | undefined
}

/**
 * 读取模板详情与当前内容版本。
 * @param db 数据库连接。
 * @param templateId 模板标识。
 * @returns 详情记录；模板或当前版本缺失时返回 undefined。
 */
export async function findTemplateDetail(db: Database, templateId: string) {
  const [row] = await db
    .select({
      id: agentTemplate.id,
      teamId: agentTemplate.team_id,
      name: agentTemplate.name,
      tag: agentTemplate.tag,
      description: agentTemplate.description,
      version: agentTemplate.version,
      updatedAt: agentTemplate.updated_at,
      createdAt: agentTemplate.created_at,
      createdByUserId: agentTemplate.created_by_user_id,
      contentVersion: agentTemplateVersion.version,
      content: agentTemplateVersion.content,
    })
    .from(agentTemplate)
    .innerJoin(agentTemplateVersion, eq(agentTemplate.current_version_id, agentTemplateVersion.id))
    .where(eq(agentTemplate.id, templateId))
    .limit(1)
  return row as TemplateDetailRecord | undefined
}

/**
 * 按团队与规范化名称查找模板。
 * @param db 数据库连接。
 * @param teamId 团队标识。
 * @param nameNormalized 去空白并转小写的名称。
 * @param excludeTemplateId 编辑时排除自身。
 * @returns 冲突模板标识；不存在时返回 undefined。
 */
export async function findTemplateByNormalizedName(
  db: KnowledgeExecutor,
  teamId: string,
  nameNormalized: string,
  excludeTemplateId?: string,
) {
  const conditions = [eq(agentTemplate.team_id, teamId), eq(agentTemplate.name_normalized, nameNormalized)]
  if (excludeTemplateId) conditions.push(sql`${agentTemplate.id} <> ${excludeTemplateId}`)
  const [row] = await db
    .select({ id: agentTemplate.id })
    .from(agentTemplate)
    .where(and(...conditions))
    .limit(1)
  return row
}

/**
 * 插入模板正文版本。
 * @param executor 数据库连接或事务。
 * @param input 版本、归属与正文。
 * @returns 新版本行。
 */
export async function insertTemplateVersion(
  executor: KnowledgeExecutor,
  input: {
    id: string
    teamId: string
    templateId: string
    version: number
    content: string
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(agentTemplateVersion)
    .values({
      id: input.id,
      team_id: input.teamId,
      template_id: input.templateId,
      version: input.version,
      content: input.content,
      created_by_user_id: input.createdByUserId,
    })
    .returning(templateVersionColumns)
  if (!row) throw new Error('模板版本写入失败')
  return row as TemplateVersionRow
}

/**
 * 插入模板记录。
 * @param tx 事务连接。
 * @param input 模板字段与当前版本标识。
 * @returns 新模板行。
 */
export async function insertTemplate(
  tx: TransactionDatabase,
  input: {
    id: string
    teamId: string
    name: string
    nameNormalized: string
    tag: string
    description: string | null
    currentVersionId: string
    createdByUserId: string
  },
) {
  const [row] = await tx
    .insert(agentTemplate)
    .values({
      id: input.id,
      team_id: input.teamId,
      name: input.name,
      name_normalized: input.nameNormalized,
      tag: input.tag,
      description: input.description,
      current_version_id: input.currentVersionId,
      created_by_user_id: input.createdByUserId,
    })
    .returning(templateColumns)
  if (!row) throw new Error('模板写入失败')
  return row as TemplateRow
}

/**
 * 乐观锁更新模板元数据与当前内容版本。
 * @param tx 事务连接。
 * @param templateId 模板标识。
 * @param expectedVersion 当前修订号。
 * @param values 待更新字段。
 * @returns 更新行；版本不匹配时返回 undefined。
 */
export async function updateTemplate(
  tx: TransactionDatabase,
  templateId: string,
  expectedVersion: number,
  values: {
    name: string
    nameNormalized: string
    tag: string
    description: string | null
    currentVersionId: string
  },
) {
  const [row] = await tx
    .update(agentTemplate)
    .set({
      name: values.name,
      name_normalized: values.nameNormalized,
      tag: values.tag,
      description: values.description,
      current_version_id: values.currentVersionId,
      version: sql`${agentTemplate.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(agentTemplate.id, templateId), eq(agentTemplate.version, expectedVersion)))
    .returning(templateColumns)
  return row as TemplateRow | undefined
}

/**
 * 查询模板版本历史。
 * @param db 数据库连接。
 * @param templateId 模板标识。
 * @param page 页码。
 * @param pageSize 每页数量。
 * @returns 版本行与总数，按版本号倒序。
 */
export async function findTemplateVersions(db: Database, templateId: string, page: number, pageSize: number) {
  const where = eq(agentTemplateVersion.template_id, templateId)
  const [rows, [total]] = await Promise.all([
    db
      .select(templateVersionColumns)
      .from(agentTemplateVersion)
      .where(where)
      .orderBy(desc(agentTemplateVersion.version))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(agentTemplateVersion).where(where),
  ])
  return { items: rows as TemplateVersionRow[], total: total?.value ?? 0 }
}

/**
 * 按标识读取模板正文版本。
 * @param executor 数据库连接或事务。
 * @param versionId 版本标识。
 * @returns 版本行；不存在时返回 undefined。
 */
export async function findTemplateVersionById(executor: KnowledgeExecutor, versionId: string) {
  const [row] = await executor
    .select(templateVersionColumns)
    .from(agentTemplateVersion)
    .where(eq(agentTemplateVersion.id, versionId))
    .limit(1)
  return row as TemplateVersionRow | undefined
}

/**
 * 读取项目当前模板选用。
 * @param executor 数据库连接或事务。
 * @param projectId 项目标识。
 * @returns 选用行；未选用时返回 undefined。
 */
export async function findProjectTemplateSelection(executor: KnowledgeExecutor, projectId: string) {
  const [row] = await executor
    .select(selectionColumns)
    .from(projectTemplateSelection)
    .where(eq(projectTemplateSelection.project_id, projectId))
    .limit(1)
  return row as SelectionRow | undefined
}

/**
 * 在事务中锁定项目当前选用行。
 * @param tx 事务连接。
 * @param projectId 项目标识。
 * @returns 选用行；未选用时返回 undefined。
 */
export async function lockProjectTemplateSelection(tx: TransactionDatabase, projectId: string) {
  const [row] = await tx
    .select(selectionColumns)
    .from(projectTemplateSelection)
    .where(eq(projectTemplateSelection.project_id, projectId))
    .for('update')
  return row as SelectionRow | undefined
}

/**
 * 插入项目模板选用。
 * @param executor 数据库连接或事务。
 * @param input 项目、模板与操作者。
 * @returns 新选用行。
 */
export async function insertProjectTemplateSelection(
  executor: KnowledgeExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    templateId: string
    selectedByUserId: string
  },
) {
  const [row] = await executor
    .insert(projectTemplateSelection)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      template_id: input.templateId,
      selected_by_user_id: input.selectedByUserId,
    })
    .returning(selectionColumns)
  if (!row) throw new Error('项目模板选用写入失败')
  return row as SelectionRow
}

/**
 * 乐观锁更新项目模板选用。
 * @param tx 事务连接。
 * @param selectionId 选用行标识。
 * @param expectedVersion 当前修订号。
 * @param values 新模板与操作者。
 * @returns 更新行；版本不匹配时返回 undefined。
 */
export async function updateProjectTemplateSelection(
  tx: TransactionDatabase,
  selectionId: string,
  expectedVersion: number,
  values: { templateId: string; selectedByUserId: string },
) {
  const [row] = await tx
    .update(projectTemplateSelection)
    .set({
      template_id: values.templateId,
      selected_by_user_id: values.selectedByUserId,
      version: sql`${projectTemplateSelection.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(projectTemplateSelection.id, selectionId), eq(projectTemplateSelection.version, expectedVersion)))
    .returning(selectionColumns)
  return row as SelectionRow | undefined
}

/**
 * 删除项目模板选用（取消选用）。
 * @param tx 事务连接。
 * @param selectionId 选用行标识。
 * @param expectedVersion 当前修订号。
 * @returns 删除的行；版本不匹配或不存在时返回 undefined。
 */
export async function deleteProjectTemplateSelection(
  tx: TransactionDatabase,
  selectionId: string,
  expectedVersion: number,
) {
  const [row] = await tx
    .delete(projectTemplateSelection)
    .where(and(eq(projectTemplateSelection.id, selectionId), eq(projectTemplateSelection.version, expectedVersion)))
    .returning(selectionColumns)
  return row as SelectionRow | undefined
}

/**
 * 读取项目当前选用模板名称与内容版本，供项目工作区展示与阶段 B 解析。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @returns 选用详情；未选用或模板不可用时返回 undefined。
 */
export async function findSelectionDetail(db: Database, projectId: string) {
  const [row] = await db
    .select({
      selection: selectionColumns,
      templateName: agentTemplate.name,
      contentVersion: agentTemplateVersion.version,
    })
    .from(projectTemplateSelection)
    .innerJoin(agentTemplate, eq(projectTemplateSelection.template_id, agentTemplate.id))
    .innerJoin(agentTemplateVersion, eq(agentTemplate.current_version_id, agentTemplateVersion.id))
    .where(eq(projectTemplateSelection.project_id, projectId))
    .limit(1)
  return row as SelectionDetailRecord | undefined
}

/**
 * 插入模板快照链接。
 * @param executor 数据库连接或事务。
 * @param input 模板版本、令牌与生成者。
 * @returns 新链接行。
 */
export async function insertTemplateSnapshotLink(
  executor: KnowledgeExecutor,
  input: {
    id: string
    teamId: string
    templateId: string
    templateVersionId: string
    token: string
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(templateSnapshotLink)
    .values({
      id: input.id,
      team_id: input.teamId,
      template_id: input.templateId,
      template_version_id: input.templateVersionId,
      token: input.token,
      created_by_user_id: input.createdByUserId,
    })
    .returning(snapshotLinkColumns)
  if (!row) throw new Error('快照链接写入失败')
  return row
}

/**
 * 按令牌读取快照链接。
 * @param db 数据库连接。
 * @param token 快照令牌。
 * @returns 链接行；不存在时返回 undefined。
 */
export async function findTemplateSnapshotLinkByToken(db: Database, token: string) {
  const [row] = await db
    .select(snapshotLinkColumns)
    .from(templateSnapshotLink)
    .where(eq(templateSnapshotLink.token, token))
    .limit(1)
  return row as SnapshotLinkRow | undefined
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
 * 读取项目当前选用模板及其内容，用于阶段 B 运行解析。
 * @param db 数据库连接。
 * @param projectId 项目标识。
 * @returns 选用行、模板与当前版本；未选用时返回 undefined。
 */
export async function findProjectTemplateForRun(db: Database, projectId: string) {
  const [row] = await db
    .select({
      selection: selectionColumns,
      templateName: agentTemplate.name,
      templateTag: agentTemplate.tag,
      templateVersionId: agentTemplateVersion.id,
      contentVersion: agentTemplateVersion.version,
      content: agentTemplateVersion.content,
      templateTeamId: agentTemplate.team_id,
    })
    .from(projectTemplateSelection)
    .innerJoin(agentTemplate, eq(projectTemplateSelection.template_id, agentTemplate.id))
    .innerJoin(agentTemplateVersion, eq(agentTemplate.current_version_id, agentTemplateVersion.id))
    .where(eq(projectTemplateSelection.project_id, projectId))
    .limit(1)
  return row
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
