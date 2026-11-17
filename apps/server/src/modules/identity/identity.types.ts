/** 用户摘要读模型，供展示名称和头像使用，不包含邮箱等敏感字段。 */
export interface UserSummary {
  id: string
  name: string | null
  image?: string | null
}

/** 认证完成后交给业务模块的用户标识和显示信息。 */
export interface SessionUser {
  id: string
  email: string
  name: string
}
