/** 用户摘要读模型，供展示名称和头像使用，不包含邮箱等敏感字段。 */
export interface UserSummary {
  id: string
  name: string | null
  image?: string | null
}
