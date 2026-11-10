import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { z } from 'zod'

const text = z.object({ type: z.literal('text'), text: z.string(), textSignature: z.string().optional() })
const thinking = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  thinkingSignature: z.string().optional(),
  redacted: z.boolean().optional(),
})
const jsonValue = z.json()
const toolCall = z.object({
  type: z.literal('toolCall'),
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), jsonValue),
  thoughtSignature: z.string().optional(),
  namespace: z.string().optional(),
  argumentsError: z.string().optional(),
})
const usage = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  reasoning: z.number().optional(),
  cacheWrite1h: z.number().optional(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
    totalFromProvider: z.boolean().optional(),
  }),
})
const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(text)]), timestamp: z.number() }),
  z.object({
    role: z.literal('assistant'),
    content: z.array(z.union([text, thinking, toolCall])),
    api: z.string(),
    provider: z.string(),
    model: z.string(),
    responseModel: z.string().optional(),
    responseId: z.string().optional(),
    providerThinkingLevel: z.string().optional(),
    usage,
    stopReason: z.enum(['stop', 'length', 'toolUse', 'error', 'aborted']),
    errorMessage: z.string().optional(),
    timestamp: z.number(),
  }),
  z.object({
    role: z.literal('toolResult'),
    toolCallId: z.string(),
    toolName: z.string(),
    content: z.array(text),
    details: jsonValue.optional(),
    isError: z.boolean(),
    timestamp: z.number(),
  }),
])

/**
 * 校验 SQLite 中的文本会话历史，只支持本应用开放的文本与记忆工具消息。
 * @param value 反序列化后的未知数据。
 * @returns 可传给 pi 的消息数组，保留完整工具调用与结果配对。
 * @throws 持久化内容损坏或不兼容时抛出数据库数据异常。
 */
export function parseHistory(value: unknown): AgentMessage[] {
  const parsed = z.array(messageSchema).safeParse(value)
  if (!parsed.success) throw new Error('数据库会话消息不合法')
  return parsed.data
}
