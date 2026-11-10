import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { z } from 'zod'
import { BotError } from './errors.ts'
import type { MemoryWorkspace } from './memory.ts'

/**
 * 创建仅操作本轮工作副本的记忆工具，不直接写库。
 * @param workspace 本轮隔离的记忆工作副本。
 * @param sessionId 记忆来源会话。
 * @returns 三个顺序执行的工具；非法参数作为工具失败交给模型处理。
 */
export function memoryTools(workspace: MemoryWorkspace, sessionId: string): AgentTool<object, null>[] {
  const definitions = [
    {
      name: 'search_memories',
      description: '按关键词检索长期记忆；空查询列出最近十条。',
      parameters: Type.Object({ query: Type.String({ maxLength: 200 }) }),
      run: (input: unknown) => workspace.search(z.object({ query: z.string().max(200) }).parse(input).query),
    },
    {
      name: 'remember_memory',
      description: '保存用户明确要求记住的稳定事实或偏好；提供 id 可更新。禁止保存凭据。',
      parameters: Type.Object({
        content: Type.String({ maxLength: 2000 }),
        essential: Type.Boolean(),
        id: Type.Optional(Type.String()),
      }),
      run: (input: unknown) => {
        const args = z.object({ content: z.string(), essential: z.boolean(), id: z.string().optional() }).parse(input)
        return workspace.remember(args.content, args.essential, sessionId, args.id)
      },
    },
    {
      name: 'forget_memory',
      description: '按 id 删除长期记忆；不知道 id 时先检索。',
      parameters: Type.Object({ id: Type.String() }),
      run: (input: unknown) => {
        workspace.forget(z.object({ id: z.string() }).parse(input).id)
        return { forgotten: true }
      },
    },
  ]
  return definitions.map((definition) => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    executionMode: 'sequential',
    /**
     * 校验并执行记忆操作，返回不含内部异常的文本结果。
     * @param _callId pi 工具调用标识。
     * @param params 模型生成的待校验参数。
     * @returns 工作副本的操作结果；参数或业务失败时抛出安全异常。
     */
    async execute(_callId, params) {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(definition.run(params)) }], details: null }
      } catch (error) {
        if (error instanceof BotError) throw error
        throw new BotError('TOOL_INPUT_INVALID', '记忆工具参数不合法')
      }
    },
  }))
}
