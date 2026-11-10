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
/** 模板列表接口数据。 */
export type TemplatePage = ApiSuccessData<'/api/v1/teams/{teamId}/agent-templates', 'get'>
/** 模板列表项。 */
export type TemplateListItem = TemplatePage['items'][number]
/** 模板详情接口数据。 */
export type TemplateDetail = ApiSuccessData<'/api/v1/agent-templates/{templateId}', 'get'>
/** 模板版本分页接口数据。 */
export type TemplateVersionPage = ApiSuccessData<'/api/v1/agent-templates/{templateId}/versions', 'get'>
/** 模板版本列表项。 */
export type TemplateVersionItem = TemplateVersionPage['items'][number]
/** 模板历史版本详情。 */
export type TemplateVersionDetail = ApiSuccessData<
  '/api/v1/agent-templates/{templateId}/versions/{templateVersionId}',
  'get'
>
/** 项目当前选用模板接口数据。 */
export type ProjectTemplateSelection = ApiSuccessData<'/api/v1/projects/{projectId}/agent-template', 'get'>
/** 模板快照链接生成结果。 */
export type SnapshotLinkCreated = ApiSuccessData<'/api/v1/agent-templates/{templateId}/snapshot-links', 'post'>
/** 模板快照打开结果。 */
export type TemplateSnapshot = ApiSuccessData<'/api/v1/template-snapshot-links/{token}', 'get'>
/** 活动分页接口数据（技能与模板共用）。 */
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
