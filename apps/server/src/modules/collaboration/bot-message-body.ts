import { Type, type Static } from 'typebox'

/** 会话持久化与响应使用同一中立消息体，工具调用只保留摘要。 */
export const botMessageBodySchema = Type.Object({
  references: Type.Optional(
    Type.Object({
      mentionBotId: Type.Optional(Type.String()),
      skillIds: Type.Array(Type.String()),
    }),
  ),
  blocks: Type.Array(
    Type.Union([
      Type.Object({ type: Type.Literal('text'), text: Type.String() }),
      Type.Object({ type: Type.Literal('notice'), text: Type.String() }),
      Type.Object({
        type: Type.Literal('tool_activity'),
        callId: Type.String(),
        name: Type.String(),
        summary: Type.String(),
        ok: Type.Optional(Type.Boolean()),
      }),
    ]),
  ),
})

export type BotMessageBody = Static<typeof botMessageBodySchema>
