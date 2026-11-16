import { Type } from 'typebox'

/** 需求与 Bug 共用的评论响应，作者 ID 保留用于定位用户。 */
export const commentSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }),
  authorUserId: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }),
  authorName: Type.String(),
  bodyMarkdown: Type.String(),
  createdAt: Type.String(),
})
