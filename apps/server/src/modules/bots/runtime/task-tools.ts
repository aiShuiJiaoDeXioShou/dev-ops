import type { BotTool } from '@dev-ops/devops-bot'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { ApiError } from '../../../platform/http/errors.ts'
import { submitTaskResultInput } from '../../tasks/bot-tasks.review.schema.ts'
import { submitBotTaskResult } from '../../tasks/bot-tasks.review.service.ts'
import type { BotRunLease } from '../bots.run-queue.repository.ts'

/**
 * 为已领取的任务运行提供结果提交工具。
 * @param db 执行服务数据库。
 * @param lease 当前任务的运行代次。
 * @returns 提交正文、说明与证据的模型工具。
 */
export function createTaskResultTool(db: Database, lease: BotRunLease): BotTool {
  return {
    name: 'submit_task_result',
    description: '工作完成后提交任务正文、完成说明与证据供成员验收。只提交一次，禁止在结果中放入凭据。',
    parameters: submitTaskResultInput,
    /** 检查模型参数并在当前租约内提交结果。 */
    async execute(input, signal) {
      signal.throwIfAborted()
      if (!Check(submitTaskResultInput, input))
        return { text: '请按工具契约提供正文、完成说明和证据列表', isError: true }
      try {
        const result = await submitBotTaskResult(db, lease, input)
        return { text: `任务结果已提交，等待成员验收。结果标识：${result.id}` }
      } catch (error) {
        if (error instanceof ApiError) return { text: error.message, isError: true }
        throw error
      }
    },
  }
}
