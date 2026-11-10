import type { SkillListItem } from './types'

/** 技能分类中文文案；键为数据库稳定分类键。 */
export const SKILL_CATEGORY_LABELS: Record<SkillListItem['category'], string> = {
  product: '产品',
  engineering: '研发',
  delivery: '交付',
}

/** 技能分类筛选项。 */
export const SKILL_CATEGORY_OPTIONS = Object.entries(SKILL_CATEGORY_LABELS) as Array<
  [SkillListItem['category'], string]
>

/** 知识活动动作中文文案；未知动作直接显示原始动作码。 */
export const KNOWLEDGE_ACTION_LABELS: Record<string, string> = {
  skill_created: '发布技能',
  skill_updated: '编辑技能',
  skill_enabled: '启用技能',
  skill_disabled: '停用技能',
  agent_template_created: '新建模板',
  agent_template_updated: '编辑模板',
  agent_template_duplicated: '创建副本',
  agent_template_applied: '选用模板',
  agent_template_selection_cleared: '取消选用模板',
  agent_template_snapshot_created: '生成快照链接',
}

/** 将活动动作码转成中文文案。 */
export function knowledgeActionLabel(action: string): string {
  return KNOWLEDGE_ACTION_LABELS[action] ?? action
}
