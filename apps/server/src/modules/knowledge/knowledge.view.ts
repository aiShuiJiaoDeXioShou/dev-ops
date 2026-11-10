import type {
  SelectionDetailRecord,
  SelectionRow,
  SkillDetailRecord,
  SkillListRecord,
  SkillVersionRow,
  TemplateDetailRecord,
  TemplateListRecord,
  TemplateVersionRow,
  SnapshotLinkRow,
} from './knowledge.repository.ts'
import { SKILL_CATEGORIES, type SkillCategory } from './knowledge.types.ts'

/** 技能列表项视图。 */
export interface SkillListItemView {
  id: string
  name: string
  identifier: string
  category: SkillCategory
  contentVersion: string
  summary: string
  source: 'team'
  enabled: boolean
  version: number
  updatedAt: string
}

/** 技能详情视图；包含当前内容版本正文。 */
export interface SkillDetailView extends SkillListItemView {
  teamId: string
  content: string
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
}

/** 模板列表项视图。 */
export interface TemplateListItemView {
  id: string
  name: string
  tag: string
  description: string | null
  contentVersion: number
  version: number
  updatedAt: string
}

/** 模板详情视图；包含当前正文。 */
export interface TemplateDetailView extends TemplateListItemView {
  teamId: string
  content: string
  createdByUserId: string
  createdAt: string
}

/** 模板版本列表项视图。 */
export interface TemplateVersionItemView {
  id: string
  contentVersion: number
  createdByUserId: string
  createdAt: string
}

/** 模板历史版本详情视图。 */
export interface TemplateVersionDetailView extends TemplateVersionItemView {
  content: string
}

/** 项目当前选用的模板视图；未选用时为 null。 */
export interface ProjectTemplateSelectionView {
  selection: {
    templateId: string
    templateName: string
    contentVersion: number
    selectedByUserId: string
    updatedAt: string
  } | null
  version: number
}

/** 模板快照链接生成结果。 */
export interface SnapshotLinkCreatedView {
  token: string
  templateId: string
  contentVersion: number
  createdAt: string
}

/** 快照链接打开结果。 */
export interface TemplateSnapshotView {
  templateId: string
  templateName: string
  tag: string
  contentVersion: number
  content: string
  createdAt: string
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
    enabled: row.enabled,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 技能详情记录 → 视图。 */
export function toSkillDetail(row: SkillDetailRecord): SkillDetailView {
  return {
    ...toSkillListItem(row),
    teamId: row.teamId,
    content: row.content,
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
  return { ...toSkillVersionItem(row), content: row.content }
}

/** 模板列表记录 → 视图。 */
export function toTemplateListItem(row: TemplateListRecord): TemplateListItemView {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    description: row.description,
    contentVersion: row.contentVersion,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 模板详情记录 → 视图。 */
export function toTemplateDetail(row: TemplateDetailRecord): TemplateDetailView {
  return {
    ...toTemplateListItem(row),
    teamId: row.teamId,
    content: row.content,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 模板版本记录 → 列表视图。 */
export function toTemplateVersionItem(row: TemplateVersionRow): TemplateVersionItemView {
  return {
    id: row.id,
    contentVersion: row.version,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 模板版本记录 → 详情视图。 */
export function toTemplateVersionDetail(row: TemplateVersionRow): TemplateVersionDetailView {
  return { ...toTemplateVersionItem(row), content: row.content }
}

/** 项目选用详情 → 视图；未选用时返回 null 与版本 0。 */
export function toProjectTemplateSelection(detail: SelectionDetailRecord | undefined): ProjectTemplateSelectionView {
  if (!detail) return { selection: null, version: 0 }
  return {
    selection: {
      templateId: detail.selection.templateId,
      templateName: detail.templateName,
      contentVersion: detail.contentVersion,
      selectedByUserId: detail.selection.selectedByUserId,
      updatedAt: detail.selection.updatedAt.toISOString(),
    },
    version: detail.selection.version,
  }
}

/** 快照链接生成结果 → 视图。 */
export function toSnapshotLinkCreated(link: SnapshotLinkRow, contentVersion: number): SnapshotLinkCreatedView {
  return {
    token: link.token,
    templateId: link.templateId,
    contentVersion,
    createdAt: link.createdAt.toISOString(),
  }
}

/** 快照链接与模板版本 → 打开结果视图。 */
export function toTemplateSnapshot(
  link: SnapshotLinkRow,
  template: { id: string; name: string; tag: string },
  version: { version: number; content: string },
): TemplateSnapshotView {
  return {
    templateId: template.id,
    templateName: template.name,
    tag: template.tag,
    contentVersion: version.version,
    content: version.content,
    createdAt: link.createdAt.toISOString(),
  }
}

/** 供测试或其他模块读取的选用行投影。 */
export type { SelectionRow }
