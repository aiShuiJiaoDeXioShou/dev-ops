import type { SkillDetailRecord, SkillListRecord, SkillVersionRow } from './knowledge.repository.ts'
import { SKILL_CATEGORIES, type SkillCategory, type SkillFileStored } from './knowledge.types.ts'

/** 技能列表项视图。 */
export interface SkillListItemView {
  id: string
  name: string
  identifier: string
  category: SkillCategory
  contentVersion: string
  summary: string
  source: 'team'
  fileCount: number
  enabled: boolean
  version: number
  updatedAt: string
}

/** 技能资源文件视图。 */
export interface SkillFileView {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  sizeBytes: number
}

/** 技能详情视图；包含当前内容版本正文与资源文件。 */
export interface SkillDetailView extends SkillListItemView {
  teamId: string
  content: string
  files: SkillFileView[]
  createdByUserId: string
  createdAt: string
}

/** 技能版本列表项视图。 */
export interface SkillVersionItemView {
  id: string
  contentVersion: string
  createdByUserId: string
  createdAt: string
}

/** 技能历史版本详情视图。 */
export interface SkillVersionDetailView extends SkillVersionItemView {
  content: string
  files: SkillFileView[]
}

/** 将数据库分类文本收窄为业务枚举；数据不合法说明是持久化异常。 */
function toSkillCategory(value: string): SkillCategory {
  if (!(SKILL_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error(`数据库技能分类不合法: ${value}`)
  }
  return value as SkillCategory
}

/** 将数据库来源收窄为团队维护；V0.3 只有该来源。 */
function toSkillSource(value: string): 'team' {
  if (value !== 'team') throw new Error(`数据库技能来源不合法: ${value}`)
  return 'team'
}

/** 技能列表记录 → 视图。 */
export function toSkillListItem(row: SkillListRecord): SkillListItemView {
  return {
    id: row.id,
    name: row.name,
    identifier: row.identifier,
    category: toSkillCategory(row.category),
    contentVersion: row.contentVersion,
    summary: row.summary,
    source: toSkillSource(row.source),
    fileCount: row.fileCount,
    enabled: row.enabled,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 技能详情记录 → 视图。 */
export function toSkillDetail(row: SkillDetailRecord): SkillDetailView {
  return {
    ...toSkillListItem({ ...row, fileCount: row.files.length }),
    teamId: row.teamId,
    content: row.content,
    files: toSkillFiles(row.files),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 技能版本记录 → 列表视图。 */
export function toSkillVersionItem(row: SkillVersionRow): SkillVersionItemView {
  return {
    id: row.id,
    contentVersion: row.contentVersion,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 技能版本记录 → 详情视图。 */
export function toSkillVersionDetail(row: SkillVersionRow): SkillVersionDetailView {
  return { ...toSkillVersionItem(row), content: row.content, files: toSkillFiles(row.files) }
}

/** 技能资源文件记录 → 视图；只返回安全字段。 */
export function toSkillFiles(files: SkillFileStored[]): SkillFileView[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    encoding: file.encoding,
    sizeBytes: file.sizeBytes,
  }))
}
