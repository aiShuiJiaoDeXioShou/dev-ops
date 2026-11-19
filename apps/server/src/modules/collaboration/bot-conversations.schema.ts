import { Type, type Static } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'
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
export const conversationBotParams = Type.Object({ conversationId: uuid, botId: uuid })
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
    mentionBotId: Type.Optional(uuid),
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
export const conversationSendResponse = apiResponseSchema(Type.Object({ message, runId: uuid }))
export const conversationEventsResponse = apiResponseSchema(
  Type.Object({
    items: Type.Array(event),
    cursor: sequence,
    resetRequired: Type.Boolean(),
    activeRuns: Type.Array(activeRun),
  }),
)

export type BotConversationView = Static<typeof conversation>
export type ConversationMemberView = Static<typeof member>
export type ConversationMessage = Static<typeof message>
export type ConversationEvent = Static<typeof event>
export type ConversationActiveRun = Static<typeof activeRun>
export type ConversationListFilters = Static<typeof conversationListQuery>
export type SendBotMessageInput = Static<typeof sendBotMessageBody>
