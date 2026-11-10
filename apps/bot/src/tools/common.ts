import type { AgentTool } from '@earendil-works/pi-agent-core'
import { z } from 'zod'
import type { BotConfig } from '../config.ts'
import { BotError } from '../errors.ts'

export const MAX_TOOL_OUTPUT_BYTES = 32 * 1024
export const MAX_FILE_BYTES = 1024 * 1024

interface ToolOutput {
  text: string
  isError?: boolean
}

interface ToolDefinition {
  name: string
  description: string
  parameters: object
  /**
   * 在校验参数后执行实际操作。
   * @param input 来自模型的未知参数。
   * @param signal 包含整轮取消与单工具超时的信号。
   * @returns 文本结果与可选失败标志；失败可以抛出安全业务异常。
   */
  run(input: unknown, signal: AbortSignal): Promise<ToolOutput>
}

/**
 * 按 UTF-8 字节预算截断文本，不保留被截断的半个字符。
 * @param text 待返回给模型的文本。
 * @param maxBytes 最大字节数，默认工具输出预算。
 * @returns 有界文本与截断标志，不保存额外输出文件。
 */
export function clipText(text: string, maxBytes = MAX_TOOL_OUTPUT_BYTES): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  return { text: new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true }), truncated: true }
}

/**
 * 创建有超时、输出预算和安全错误的 pi 工具，不自动重试有副作用的操作。
 * @param config 工具超时与当前模型凭据，仅用于调用和输出脱敏。
 * @param definition 工具参数声明与实际操作。
 * @returns 顺序执行的工具；参数、取消、超时和操作失败作为工具错误返回模型。
 */
export function defineTool(config: BotConfig, definition: ToolDefinition): AgentTool<object, null> {
  return {
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    executionMode: 'sequential',
    /**
     * 执行工具并释放本次超时计时器。
     * @param _callId pi 工具调用标识。
     * @param params 待校验的模型参数。
     * @param parentSignal 整轮对话的取消信号。
     * @returns 有界且脱敏的结果，不向模型暴露内部堆栈或原始上游异常。
     */
    async execute(_callId, params, parentSignal) {
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, ...(parentSignal ? [parentSignal] : [])])
      const timer = setTimeout(() => controller.abort(), config.toolTimeoutMs)
      try {
        signal.throwIfAborted()
        const result = await definition.run(params, signal)
        signal.throwIfAborted()
        const redacted = config.apiKey ? result.text.replaceAll(config.apiKey, '[已隐藏密钥]') : result.text
        const output = clipText(redacted, MAX_TOOL_OUTPUT_BYTES - 128)
        return {
          content: [{ type: 'text', text: output.text + (output.truncated ? '\n[输出已截断，请缩小范围重试]' : '') }],
          details: null,
          isError: result.isError,
        }
      } catch (error) {
        let message = '工具执行失败，请检查目标地址、路径或运行环境'
        if (signal.aborted) message = controller.signal.aborted ? '工具执行超时' : '工具执行已取消'
        else if (error instanceof BotError) message = error.message
        else if (error instanceof z.ZodError) message = '工具参数不合法，请按工具声明提供参数'
        else if (error instanceof Error && 'code' in error) {
          if (error.code === 'ENOENT') message = '文件或工作目录不存在'
          if (error.code === 'EEXIST') message = '文件已存在，覆盖前请读取文件并显式设置 overwrite=true'
          if (error.code === 'EACCES' || error.code === 'EPERM') message = '当前用户没有操作权限'
        }
        return { content: [{ type: 'text', text: message }], details: null, isError: true }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
