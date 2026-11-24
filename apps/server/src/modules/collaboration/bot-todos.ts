import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'

export const conversationTodos = Type.Array(
  Type.Object({
    text: Type.String({ minLength: 1, maxLength: 300 }),
    status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')]),
  }),
  { maxItems: 30 },
)

/** 校验数据库待办清单；非法数据抛出异常，不当作空清单返回。 */
export function readConversationTodos(value: unknown): Static<typeof conversationTodos> {
  if (!Check(conversationTodos, value)) throw new Error('数据库会话待办清单不合法')
  return value
}
