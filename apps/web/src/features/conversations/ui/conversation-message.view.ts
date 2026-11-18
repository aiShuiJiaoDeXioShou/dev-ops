import type { ConversationMessage } from '../api/queries'

export type MessageView = {
  id: string
  runId?: string
  name: string
  kind: ConversationMessage['speakerKind']
  text: string
  time?: string
  bot?: { id: string; avatarKey?: string | null; enabled?: boolean }
  status?: string
  statusText?: string
  elapsed?: string
  memoryChanges?: string[]
  metrics?: ConversationMessage['body']['metrics']
  feedback?: ConversationMessage['feedback']
}
