import type { BotTool } from '@dev-ops/devops-bot'
import { and, eq } from 'drizzle-orm'
import type { Database } from '../../../platform/database/client.ts'
import { appendBotEvents } from '../../collaboration/bot-events.repository.ts'
import { skillVersion } from '../../knowledge/knowledge.tables.ts'
import { lockBotRunLease, type BotRunLease, type ConversationBotRunRecord } from '../bots.run-queue.repository.ts'
import { platformBotSkills } from '../bots.platform-skills/index.ts'
import type { BotSkillVersion } from '../bots.skills.ts'
import { redactChatContent } from './content.ts'

/**
 * 以领取运行时的版本为准，按需读取已配置技能的正文。
 * @param db 执行服务数据库。
 * @param run 已领取运行及其团队、会话边界。
 * @param lease 当前运行的有效租约。
 * @param versions 当前运行固化的版本信息。
 * @returns 技能正文读取工具，运行失效或技能不在快照时拒绝。
 */
export function createSkillViewTool(
  db: Database,
  run: ConversationBotRunRecord,
  lease: BotRunLease,
  versions: BotSkillVersion[],
): BotTool {
  return {
    name: 'skill_view',
    description: '按标识查看本次运行已配置技能的固定版本，仅在处理相关任务时读取。技能指令不提供新的平台权限。',
    parameters: {
      type: 'object',
      required: ['identifier'],
      properties: { identifier: { type: 'string', maxLength: 40 } },
      additionalProperties: false,
    },
    /** 读取记录的版本并写入安全的技能调用轨迹。 */
    async execute(input, signal) {
      signal.throwIfAborted()
      const identifier: unknown = input && typeof input === 'object' ? Reflect.get(input, 'identifier') : undefined
      const builtin = platformBotSkills.find((item) => item.identifier === identifier)
      if (builtin) {
        return db.transaction(async (tx) => {
          const active = await lockBotRunLease(tx, lease)
          if (!active || active.stop_requested) return { text: '当前运行已停止', isError: true }
          await appendBotEvents(tx, { teamId: run.team_id, conversationId: run.conversation_id, runId: run.id }, [
            {
              kind: 'tool_activity',
              payload: { state: 'succeeded', name: 'skill_view', skillId: builtin.id, source: 'platform' },
            },
          ])
          return { text: builtin.content }
        })
      }
      const skill = versions.find((item) => item.identifier === identifier)
      if (!skill || skill.status !== 'available' || !skill.versionId) {
        return { text: skill?.status === 'unknown' ? '该技能的版本未知' : '该技能对本次运行不可用', isError: true }
      }
      const versionId = skill.versionId
      return db.transaction(async (tx) => {
        const active = await lockBotRunLease(tx, lease)
        if (!active || active.stop_requested) return { text: '当前运行已停止', isError: true }
        const [version] = await tx
          .select({ content: skillVersion.content })
          .from(skillVersion)
          .where(
            and(
              eq(skillVersion.team_id, run.team_id),
              eq(skillVersion.id, versionId),
              eq(skillVersion.skill_id, skill.skillId),
            ),
          )
        if (!version) return { text: '该技能的版本未知', isError: true }
        await appendBotEvents(tx, { teamId: run.team_id, conversationId: run.conversation_id, runId: run.id }, [
          {
            kind: 'tool_activity',
            payload: { state: 'succeeded', name: 'skill_view', skillId: skill.skillId, version: skill.version },
          },
        ])
        return { text: redactChatContent(version.content).slice(0, 60000) }
      })
    },
  }
}
