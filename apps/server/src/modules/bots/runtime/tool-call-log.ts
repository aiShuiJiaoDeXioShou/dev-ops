export type BotCallLog = {
  runId: string
  teamId: string
  conversationId: string
  botId: string
  callId: string
  kind: 'platform_api' | 'web_fetch' | 'web_search'
  status: 'succeeded' | 'rejected' | 'failed' | 'unknown'
  code: string
}
