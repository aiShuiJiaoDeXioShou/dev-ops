import type { ApiSuccessData } from '@dev-ops/api-client'

/** 技能列表接口数据。 */
export type SkillPage = ApiSuccessData<'/api/v1/teams/{teamId}/skills', 'get'>
/** 技能列表项。 */
export type SkillListItem = SkillPage['items'][number]
/** 技能详情接口数据。 */
export type SkillDetail = ApiSuccessData<'/api/v1/skills/{skillId}', 'get'>
/** 技能版本分页接口数据。 */
export type SkillVersionPage = ApiSuccessData<'/api/v1/skills/{skillId}/versions', 'get'>
/** 技能版本列表项。 */
export type SkillVersionItem = SkillVersionPage['items'][number]
/** 技能历史版本详情。 */
export type SkillVersionDetail = ApiSuccessData<'/api/v1/skills/{skillId}/versions/{skillVersionId}', 'get'>
/** 技能活动分页接口数据。 */
export type KnowledgeActivityPage = ApiSuccessData<'/api/v1/skills/{skillId}/activities', 'get'>
/** 活动列表项。 */
export type KnowledgeActivityItem = KnowledgeActivityPage['items'][number]

/** 技能资源文件（从技能详情类型推导）。 */
export type SkillFile = SkillDetail['files'][number]

/** 技能资源文件草稿：表单编辑时使用，大小由保存时服务端计算。 */
export interface SkillFileDraft {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  sizeBytes?: number
}

/** 技能包目录导入结果。 */
export interface ImportedSkillPackage {
  frontmatterName: string | null
  summary: string | null
  body: string
  files: SkillFileDraft[]
}
