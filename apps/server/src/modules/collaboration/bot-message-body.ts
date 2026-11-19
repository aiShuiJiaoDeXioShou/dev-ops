import { Type, type Static } from 'typebox'

/** 会话持久化与响应使用同一中立消息体，工具调用只保留摘要。 */
export const botMessageBodySchema = Type.Object({
  metrics: Type.Optional(
    Type.Object({
      inputTokens: Type.Integer({ minimum: 0 }),
      outputTokens: Type.Integer({ minimum: 0 }),
      cacheReadTokens: Type.Integer({ minimum: 0 }),
      cacheWriteTokens: Type.Integer({ minimum: 0 }),
      costUsd: Type.Number({ minimum: 0 }),
      costKnown: Type.Optional(Type.Boolean()),
      turns: Type.Integer({ minimum: 0 }),
      durationMs: Type.Number({ minimum: 0 }),
    }),
  ),
  references: Type.Optional(
    Type.Object({
      promptTemplate: Type.Optional(Type.Object({ id: Type.String(), name: Type.String(), sourceText: Type.String() })),
      deliveryMode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('steer')])),
      mentionBotIds: Type.Optional(Type.Array(Type.String())),
      mentionAll: Type.Optional(Type.Boolean()),
      relayRecipients: Type.Optional(Type.Array(Type.String())),
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
