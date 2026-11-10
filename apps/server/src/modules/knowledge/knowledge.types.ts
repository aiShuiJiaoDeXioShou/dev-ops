/** 技能分类的稳定存储键；展示文案由 view 层映射为中文。 */
export const SKILL_CATEGORIES = ['product', 'engineering', 'delivery'] as const
export type SkillCategory = (typeof SKILL_CATEGORIES)[number]

/** 技能内容版本格式：成员维护的三段式版本。 */
export const SKILL_CONTENT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

/** 技能调用标识格式：小写字母、数字和连字符。 */
export const SKILL_IDENTIFIER_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 技能资源文件的编码：UTF-8 文本或 base64 二进制。 */
export type SkillFileEncoding = 'utf8' | 'base64'

/** 技能资源文件输入：路径相对于技能根目录，SKILL.md 由技能正文单独维护。 */
export interface SkillFileInput {
  path: string
  content: string
  encoding: SkillFileEncoding
}

/** 已校验并计算大小的技能资源文件。 */
export interface SkillFileStored extends SkillFileInput {
  sizeBytes: number
}

/** 阶段 B：已解析的可用技能引用；只含运行需要的标识，不返回正文。 */
export interface ResolvedSkillRef {
  skillId: string
  name: string
  identifier: string
  contentVersion: string
  skillVersionId: string
}

/** 阶段 B：给定技能中不可用的原因，由调用方决定展示文案。 */
export interface MissingSkillRef {
  skillId: string
  reason: 'not_found' | 'other_team' | 'disabled' | 'no_version'
}

/** 阶段 B：一次运行候选技能的解析结果。 */
export interface ResolveSkillsForRunResult {
  skills: ResolvedSkillRef[]
  missing: MissingSkillRef[]
}

/** 阶段 B：可配置给 Bot 的技能候选。 */
export interface AssignableSkillRef {
  skillId: string
  name: string
  identifier: string
  category: SkillCategory
  contentVersion: string
}

/** 阶段 B：项目当前选用模板的解析结果。 */
export interface ResolvedProjectTemplate {
  templateId: string
  templateName: string
  templateVersionId: string
  contentVersion: number
  content: string
}

/** 阶段 B：项目模板解析的三态结果。 */
export type ResolveProjectTemplateForRunResult =
  | { status: 'selected'; template: ResolvedProjectTemplate }
  | { status: 'not_selected' }
  | { status: 'unavailable'; reason: 'project_not_found' | 'project_other_team' | 'template_unavailable' }
