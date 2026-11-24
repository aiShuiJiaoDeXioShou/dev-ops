import type { ConversationMessage } from '../api/queries'
import type { TraceStep } from '../model/conversation-trace'

export type MessageView = {
  id: string
  runId?: string
  name: string
  kind: ConversationMessage['speakerKind']
  text: string
  time?: string
  status?: string
  statusText?: string
  /** 失败运行的原因说明；挂在触发消息下，随消息历史滚动而不是常驻末尾。 */
  failureText?: string
  workSteps?: TraceStep[]
  elapsed?: string
  isStored?: boolean
  canEdit?: boolean
  branchSiblings?: ConversationMessage['branchSiblings']
  templateName?: string
  attachments?: ConversationMessage['body']['attachments']
  memoryChanges?: string[]
  metrics?: ConversationMessage['body']['metrics']
  feedback?: ConversationMessage['feedback']
}
