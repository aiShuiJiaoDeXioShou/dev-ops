import type { RunBotSessionOptions } from '@dev-ops/devops-bot'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../../platform/database/client.ts'
import { skillVersion } from '../../knowledge/knowledge.tables.ts'
import { platformBotSkills } from '../bots.platform-skills/index.ts'
import type { BotSkillVersion } from '../bots.skills.ts'
import { redactChatContent } from './content.ts'

/**
 * 将运行已固定的技能版本与平台内置技能组装成内存资源。
 * @param db 执行服务数据库。
 * @param teamId 运行所在团队。
 * @param versions 初次领取时固定的团队技能版本。
 * @returns 技能简介和工作目录中会物化的正文，内置同名项优先。
 */
export async function readRuntimeSkills(
  db: Database,
  teamId: string,
  versions: readonly BotSkillVersion[],
): Promise<NonNullable<RunBotSessionOptions['skills']>> {
  const available = versions.filter(({ status }) => status === 'available')
  const ids = available.flatMap(({ versionId }) => (versionId ? [versionId] : []))
  const rows = ids.length
    ? await db
        .select({ id: skillVersion.id, skillId: skillVersion.skill_id, body: skillVersion.content })
        .from(skillVersion)
        .where(and(eq(skillVersion.team_id, teamId), inArray(skillVersion.id, ids)))
    : []
  const byId = new Map(rows.map((row) => [row.id, row]))
  const builtInIdentifiers = new Set(platformBotSkills.map(({ identifier }) => identifier))
  return [
    ...platformBotSkills.map((skill) => ({
      id: skill.id,
      name: skill.identifier,
      description: skill.summary,
      body: skill.content,
      source: 'platform' as const,
    })),
    ...available.flatMap((skill) => {
      const row = skill.versionId ? byId.get(skill.versionId) : undefined
      if (!row || row.skillId !== skill.skillId || builtInIdentifiers.has(skill.identifier)) return []
      return [
        {
          id: skill.skillId,
          name: skill.identifier,
          description: skill.summary,
          body: redactChatContent(row.body).slice(0, 60000),
          source: 'team' as const,
        },
      ]
    }),
  ]
}
