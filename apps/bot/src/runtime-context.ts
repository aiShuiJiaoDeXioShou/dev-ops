import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { toToolDeclaration, type Tool } from '@earendil-works/pi-ai'
import { z } from 'zod'

const taggedUser = z.object({ role: z.literal('user'), runtimeContextKey: z.string() })

/**
 * 为实际工具契约生成稳定指纹，工具顺序变化不影响会话兼容性。
 * @param tools 当前运行可调用的完整工具清单。
 * @returns 随工具名称、说明或参数契约变化的 SHA-256 指纹，不包含密钥。
 */
export function runtimeContextKey(tools: Tool[]): string {
  const declarations = tools.map(toToolDeclaration).sort((left, right) => left.name.localeCompare(right.name))
  return createHash('sha256')
    .update(`bot-tools-v1:${JSON.stringify(declarations)}`)
    .digest('hex')
}

/**
 * 恢复最后一次工具环境变化之后的完整对话轮次，不修改持久化历史。
 * @param messages 已校验的历史，旧版本没有工具指纹时按不兼容处理。
 * @param key 本轮工具契约指纹。
 * @returns 最后一个不兼容轮次之后的历史，从用户消息开始，保留工具调用与结果配对。
 */
export function compatibleHistory(messages: AgentMessage[], key: string): AgentMessage[] {
  let start = 0
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user') continue
    const tagged = taggedUser.safeParse(message)
    if (!tagged.success || tagged.data.runtimeContextKey !== key) start = index + 1
  }
  while (start < messages.length && messages[start]?.role !== 'user') start += 1
  return messages.slice(start)
}

/**
 * 在本轮用户消息上记录工具环境，用于后续启动时判断历史兼容性。
 * @param messages 本轮新增的原生 pi 消息。
 * @param key 本轮工具契约指纹。
 * @returns 新数组，保留原生消息协议，只为用户消息追加持久化元数据。
 */
export function tagRuntimeMessages(messages: AgentMessage[], key: string): AgentMessage[] {
  return messages.map((message) => (message.role === 'user' ? { ...message, runtimeContextKey: key } : message))
}
