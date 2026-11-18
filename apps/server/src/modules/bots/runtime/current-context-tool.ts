import type { BotTool } from '@dev-ops/devops-bot'
import { and, eq } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { toTeamRole } from '../../identity/identity.rules.ts'
import { team, teamMember } from '../../identity/identity.tables.ts'
import { lockBotRunLease, type BotRunLease } from '../bots.run-queue.repository.ts'

const inputSchema = Type.Object({}, { additionalProperties: false })

/**
 * 提供按需查询本次运行所属团队和触发人的工具。
 * @param db 执行服务数据库。
 * @param lease 当前运行的租约，用于确定团队和触发人。
 * @returns 无参数的读取工具；运行停止、租约失效或成员不可用时返回失败。
 */
export function createCurrentContextTool(db: Database, lease: BotRunLease): BotTool {
  return {
    name: 'get_current_context',
    description: '读取当前会话所属团队的名称、teamId，以及触发这次运行的用户 userId 和团队角色。无需参数。',
    parameters: inputSchema,
    /**
     * 按当前租约读取团队和成员信息，避免用模型提供的标识决定查询范围。
     * @param input 模型提供的空参数对象。
     * @param signal 运行的取消信号。
     * @returns 四个上下文字段的 JSON；取消和数据库异常交由运行时处理。
     */
    async execute(input, signal) {
      signal.throwIfAborted()
      if (!Check(inputSchema, input)) return { text: '此工具无需参数', isError: true }
      return db.transaction(async (tx) => {
        const run = await lockBotRunLease(tx, lease)
        if (!run || run.stop_requested) return { text: '当前运行已停止', isError: true }
        const [context] = await tx
          .select({ teamName: team.name, teamId: team.id, userId: teamMember.user_id, role: teamMember.role })
          .from(teamMember)
          .innerJoin(team, eq(team.id, teamMember.team_id))
          .where(
            and(
              eq(teamMember.team_id, run.team_id),
              eq(teamMember.user_id, run.trigger_user_id),
              eq(teamMember.status, 'active'),
            ),
          )
        if (!context) return { text: '当前团队或用户已不可用', isError: true }
        return { text: JSON.stringify({ ...context, role: toTeamRole(context.role) }) }
      })
    },
  }
}
