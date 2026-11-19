import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'
import { botSessionSettingBody, effectiveBotThinkingLevel } from '../bots/bots.session-settings.ts'
import { botMessageBodySchema } from './bot-message-body.ts'
import { workTagViewSchema } from './work-tags.schema.ts'

const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const kind = Type.Union([Type.Literal('direct'), Type.Literal('group')])
const nullableId = Type.Union([uuid, Type.Null()])
const sequence = Type.String({ pattern: '^(?:0|[1-9][0-9]{0,18})$' })
const feedbackRating = Type.Union([Type.Literal('helpful'), Type.Literal('unhelpful'), Type.Null()])
export const messageFeedbackParams = Type.Object({ conversationId: uuid, messageId: uuid })
export const messageFeedbackBody = Type.Object({ rating: feedbackRating }, { additionalProperties: false })
export const messageFeedbackResponse = apiResponseSchema(Type.Object({ id: uuid, rating: feedbackRating }))
const conversation = Type.Object({
  id: uuid,
  teamId: uuid,
  kind,
  name: Type.String(),
  leaderBotId: nullableId,
  responsibility: Type.String(),
  instructions: Type.String(),
  lastMessageAt: Type.String(),
  forkedFrom: Type.Optional(Type.Object({ conversationId: uuid, messageId: uuid })),
})
const member = Type.Object({
  id: uuid,
  kind: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
  name: Type.String(),
  avatarKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  responsibility: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
})
const message = Type.Object({
  id: uuid,
  sequence,
  speakerKind: Type.Union([Type.Literal('user'), Type.Literal('bot'), Type.Literal('system')]),
  speakerId: nullableId,
  speakerName: Type.Union([Type.String(), Type.Null()]),
  body: botMessageBodySchema,
  runId: nullableId,
  createdAt: Type.String(),
  feedback: Type.Optional(feedbackRating),
  branchId: Type.Optional(nullableId),
  relayId: Type.Optional(nullableId),
  branchSiblings: Type.Optional(
    Type.Object({ index: Type.Integer({ minimum: 1 }), total: Type.Integer({ minimum: 2 }) }),
  ),
})
export const conversationEventKind = Type.Union([
  Type.Literal('run_status'),
  Type.Literal('output_delta'),
  Type.Literal('tool_activity'),
  Type.Literal('message_committed'),
  Type.Literal('compaction_started'),
  Type.Literal('compaction_finished'),
  Type.Literal('resumed'),
  Type.Literal('steer_delivered'),
  Type.Literal('follow_up_delivered'),
  Type.Literal('reply_skipped'),
  Type.Literal('mcp_call_started'),
  Type.Literal('mcp_call_finished'),
  Type.Literal('relay_paused'),
  Type.Literal('relay_finished'),
])
export const botRelaySchema = Type.Object({
  id: uuid,
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('paused'),
    Type.Literal('finished'),
    Type.Literal('stopped'),
  ]),
  hopCount: Type.Integer(),
  hopLimit: Type.Integer(),
  replyCount: Type.Integer(),
  replyLimit: Type.Integer(),
  continueCount: Type.Integer(),
  version: Type.Integer(),
  pendingBotIds: Type.Array(uuid),
  endReason: Type.Optional(
    Type.Union([
      Type.Literal('completed'),
      Type.Literal('limit'),
      Type.Literal('stopped_by_member'),
      Type.Literal('budget_exhausted'),
      Type.Literal('ended_by_member'),
    ]),
  ),
})
export const botRelayResponse = apiResponseSchema(botRelaySchema)
export type BotRelayView = Static<typeof botRelaySchema>
const event = Type.Object({
  sequence,
  runId: uuid,
  kind: conversationEventKind,
  payload: Type.Unknown(),
  createdAt: Type.String(),
})
const activeRun = Type.Object({
  id: uuid,
  botId: uuid,
  status: Type.Union([Type.Literal('queued'), Type.Literal('running')]),
  teamQueuePosition: Type.Optional(Type.Integer({ minimum: 1 })),
  queueReason: Type.Optional(Type.Literal('worker_offline')),
})

export const conversationParams = Type.Object({ conversationId: uuid })
export const editResendBody = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 16000 }),
    clientRequestId: uuid,
  },
  { additionalProperties: false },
)
export const switchBotBranchBody = Type.Object(
  {
    messageId: uuid,
    direction: Type.Union([Type.Literal('previous'), Type.Literal('next')]),
  },
  { additionalProperties: false },
)
export const switchBotBranchResponse = apiResponseSchema(Type.Object({ branchId: nullableId }))
export const forkConversationBody = Type.Object(
  { messageId: uuid, name: Type.Optional(Type.String({ maxLength: 80 })) },
  { additionalProperties: false },
)
export const conversationBotParams = Type.Object({ conversationId: uuid, botId: uuid })
const nullableModelId = Type.Union([Type.String(), Type.Null()])
export const conversationSettingsResponse = apiResponseSchema(
  Type.Object({
    botId: uuid,
    modelId: nullableModelId,
    thinkingLevel: botSessionSettingBody.properties.thinkingLevel,
  }),
)
const botSetting = Type.Object({
  botId: uuid,
  modelId: nullableModelId,
  thinkingLevel: botSessionSettingBody.properties.thinkingLevel,
  effectiveThinkingLevel: Type.Union([effectiveBotThinkingLevel, Type.Null()]),
  isOverrideValid: Type.Boolean(),
})
export const conversationCompactResponse = apiResponseSchema(Type.Object({ runId: uuid }))
export const conversationReseedResponse = apiResponseSchema(Type.Object({ botId: uuid }))
export const conversationTeamParams = Type.Object({ teamId: uuid })
export const conversationListQuery = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 80 })),
    tagId: Type.Optional(uuid),
    cursor: Type.Optional(uuid),
  },
  { additionalProperties: false },
)
export const conversationMessagesQuery = Type.Object(
  {
    before: Type.Optional(sequence),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
)
export const conversationEventsQuery = Type.Object(
  { after: Type.Optional(sequence), runId: Type.Optional(uuid) },
  { additionalProperties: false },
)
export const createDirectConversationBody = Type.Object(
  { kind: Type.Literal('direct'), botId: uuid },
  { additionalProperties: false },
)
export const sendBotMessageBody = Type.Object(
  {
    clientRequestId: uuid,
    text: Type.String({ minLength: 1, maxLength: 16000 }),
    mentionBotIds: Type.Optional(Type.Array(uuid, { maxItems: 100 })),
    mentionAll: Type.Optional(Type.Boolean()),
    promptTemplateId: Type.Optional(uuid),
    deliveryMode: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('steer')])),
    skillIds: Type.Optional(Type.Array(uuid, { maxItems: 20, uniqueItems: true })),
  },
  { additionalProperties: false },
)

export const conversationListResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(
      Type.Object({
        ...conversation.properties,
        botAvatars: Type.Array(
          Type.Object({ id: uuid, avatarKey: Type.Union([Type.String(), Type.Null()]), enabled: Type.Boolean() }),
        ),
        lastMessagePreview: Type.Union([Type.String(), Type.Null()]),
      }),
    ),
    nextCursor: nullableId,
  }),
)
export const conversationResponse = apiResponseSchema(
  Type.Object({
    ...conversation.properties,
    botSettings: Type.Array(botSetting),
    activeRelay: Type.Optional(botRelaySchema),
    members: Type.Array(member),
    tags: Type.Array(workTagViewSchema),
    skillReferences: Type.Array(
      Type.Object({
        id: uuid,
        name: Type.String(),
        identifier: Type.String(),
        summary: Type.String(),
        botIds: Type.Array(uuid),
      }),
    ),
  }),
)
export const conversationMessagesResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(message),
    nextBefore: Type.Union([sequence, Type.Null()]),
  }),
)
export const conversationSendResponse = apiResponseSchema(
  Type.Object({
    message,
    runId: uuid,
    relay: Type.Optional(botRelaySchema),
    delivery: Type.Union([Type.Literal('queued'), Type.Literal('follow_up'), Type.Literal('steer')]),
  }),
)
export const conversationEventsResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(event),
    cursor: sequence,
    resetRequired: Type.Boolean(),
    activeRelay: Type.Optional(botRelaySchema),
    activeRuns: Type.Array(activeRun),
  }),
)

export type BotConversationView = Static<typeof conversation>
export type ConversationMemberView = Static<typeof member>
export type ConversationMessage = Static<typeof message>
export type ConversationEvent = Static<typeof event>
export type ConversationActiveRun = Static<typeof activeRun>
export type ConversationListFilters = Static<typeof conversationListQuery>
export type SendBotMessageResult = {
  message: Static<typeof message>
  runId: string
  relay?: BotRelayView
  delivery: 'queued' | 'steer' | 'follow_up'
}
export type SendBotMessageInput = Static<typeof sendBotMessageBody>
