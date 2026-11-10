import { BotError } from './errors.ts'
import { MemoryWorkspace } from './memory.ts'
import type { RunInput, RunResult } from './runtime.ts'
import type { BotStore } from './storage/store.ts'

/**
 * 运行一轮对话，模型成功后才共同保存消息和记忆。
 * @param store 本地存储连接。
 * @param runtime 可替换的模型运行函数。
 * @param session 会话名称。
 * @param prompt 用户文本，最多 16000 个字符。
 * @param signal 可选的用户取消信号。
 * @returns 模型最终文本；失败或并发冲突时不保存本轮对话和记忆，外部工具操作不回滚。
 */
export async function chat(
  store: BotStore,
  runtime: (input: RunInput) => Promise<RunResult>,
  session: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!prompt.trim() || prompt.length > 16000) throw new BotError('PROMPT_INVALID', '消息须为 1-16000 个字符')
  const snapshot = store.snapshot(session)
  const workspace = new MemoryWorkspace(snapshot.memories)
  const result = await runtime({
    prompt,
    sessionId: snapshot.sessionId,
    messages: snapshot.messages,
    workspace,
    signal,
  })
  if (signal?.aborted) throw new BotError('RUN_ABORTED', '本轮已取消，对话和记忆未保存；已执行的工具操作不会回滚')
  store.commit(snapshot, result.messages, workspace.list())
  return result.text
}
