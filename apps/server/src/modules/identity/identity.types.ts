/** 用户摘要读模型，仅供展示名称使用，不包含邮箱等敏感字段。 */
export interface UserSummary {
  id: string
  name: string | null
}
