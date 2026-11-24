import type { BotTool } from '@dev-ops/devops-bot'
import type { Database } from '../../../platform/database/client.ts'
import { lockBotRunLease, type BotRunLease, type ConversationBotRunRecord } from '../bots.run-queue.repository.ts'
import type { BotCallLog } from './tool-call-log.ts'
import { botApiCall } from '../bots.tables.ts'

/**
 * 记录联网工具的公开类型与状态，正文、查询词和完整 URL 不写入轨迹。
 * @param db 执行服务数据库。
 * @param run 已领取的当前运行。
 * @param lease 运行的领取代次。
 * @param tools 实际注册的联网工具列表。
 * @param logCall 记录调用状态的结构化日志回调。
 * @returns 使用同一工具定义并附加脱敏审计的工具。
 */
export function auditBotWebTools(
  db: Database,
  run: ConversationBotRunRecord,
  lease: BotRunLease,
  tools: BotTool[],
  logCall?: (event: BotCallLog) => void,
): BotTool[] {
  return tools.map((tool) => {
    const name = tool.name
    if (name !== 'web_search' && name !== 'web_fetch') return tool
    return {
      ...tool,
      /** 将工具完成状态写入当前代次的调用轨迹。 */
      async execute(input, signal) {
        const result = await tool.execute(input, signal)
        const status = result.isError ? 'failed' : 'succeeded'
        const code = result.isError ? 'FAILED' : 'OK'
        const callId = await db.transaction(async (tx) => {
          if (!(await lockBotRunLease(tx, lease))) throw new Error('Bot 运行租约已失效')
          const [call] = await tx
            .insert(botApiCall)
            .values({
              team_id: run.team_id,
              run_id: run.id,
              kind: name,
              target: name,
              input_summary: name === 'web_search' ? '搜索公开资料' : '读取公开网页',
              status,
              result_code: code,
            })
            .returning({ id: botApiCall.id })
          return call?.id
        })
        if (callId)
          logCall?.({
            runId: run.id,
            teamId: run.team_id,
            botId: run.bot_id,
            conversationId: run.conversation_id,
            callId,
            kind: name,
            status,
            code,
          })
        return result
      },
    }
  })
}
