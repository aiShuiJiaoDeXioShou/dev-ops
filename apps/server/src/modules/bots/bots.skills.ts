import { and, asc, eq, inArray } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { skill, skillVersion } from '../knowledge/knowledge.tables.ts'
import { botSkill } from './bots.tables.ts'

const optionalId = Type.Union([Type.String(), Type.Null()])
export const botSkillVersionSchema = Type.Object({
  skillId: Type.String(),
  name: Type.String(),
  identifier: Type.String(),
  summary: Type.String(),
  versionId: optionalId,
  version: optionalId,
  status: Type.Union([Type.Literal('available'), Type.Literal('unavailable'), Type.Literal('unknown')]),
})
const snapshotSchema = Type.Array(botSkillVersionSchema)
export type BotSkillVersion = Static<typeof botSkillVersionSchema>

/**
 * 从已经保存的运行快照读取技能内容版本。
 * @param snapshot 运行配置的数据库 JSON。
 * @returns 已知的技能版本数组；历史运行缺失版本信息时返回 null。
 */
export function skillVersionsOf(snapshot: unknown): BotSkillVersion[] | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const versions: unknown = Reflect.get(snapshot, 'skillVersions')
  return Check(snapshotSchema, versions) ? versions : null
}

/**
 * 从团队定义读取运行开始时的技能标识、摘要与内容版本。
 * @param db 数据库或当前调度事务。
 * @param teamId 运行所属团队。
 * @param botId 已配置技能的 Bot。
 * @returns 已配置技能与版本状态，不包含指令正文。
 */
export async function snapshotBotSkills(
  db: Pick<Database, 'select'>,
  teamId: string,
  botId: string,
): Promise<BotSkillVersion[]> {
  const rows = await db
    .select({
      skillId: skill.id,
      name: skill.name,
      identifier: skill.identifier,
      summary: skill.summary,
      enabled: skill.enabled,
      versionId: skillVersion.id,
      version: skillVersion.content_version,
    })
    .from(botSkill)
    .innerJoin(skill, and(eq(skill.id, botSkill.skill_id), eq(skill.team_id, botSkill.team_id)))
    .leftJoin(
      skillVersion,
      and(
        eq(skillVersion.id, skill.current_version_id),
        eq(skillVersion.team_id, skill.team_id),
        eq(skillVersion.skill_id, skill.id),
      ),
    )
    .where(and(eq(botSkill.team_id, teamId), eq(botSkill.bot_id, botId)))
    .orderBy(asc(skill.identifier))
    .limit(50)
  return rows.map(({ enabled, ...version }) => ({
    ...version,
    status: !enabled ? 'unavailable' : version.versionId ? 'available' : 'unknown',
  }))
}

/**
 * 读取会话中可用 Bot 共同提供的技能候选。
 * @param db 数据库或当前会话事务。
 * @param teamId 会话所属团队。
 * @param runnableBotIds 已判定可运行的会话成员。
 * @returns 按已启用定义聚合的候选及支持 Bot 标识。
 */
export async function readBotSkillCandidates(db: Pick<Database, 'select'>, teamId: string, runnableBotIds: string[]) {
  if (runnableBotIds.length === 0) return []
  const rows = await db
    .select({
      id: skill.id,
      name: skill.name,
      identifier: skill.identifier,
      summary: skill.summary,
      botId: botSkill.bot_id,
    })
    .from(botSkill)
    .innerJoin(
      skill,
      and(eq(skill.id, botSkill.skill_id), eq(skill.team_id, botSkill.team_id), eq(skill.enabled, true)),
    )
    .innerJoin(
      skillVersion,
      and(
        eq(skillVersion.id, skill.current_version_id),
        eq(skillVersion.team_id, skill.team_id),
        eq(skillVersion.skill_id, skill.id),
      ),
    )
    .where(and(eq(botSkill.team_id, teamId), inArray(botSkill.bot_id, runnableBotIds)))
    .orderBy(asc(skill.identifier), asc(botSkill.bot_id))
    .limit(2500)
  const grouped = new Map<string, { id: string; name: string; identifier: string; summary: string; botIds: string[] }>()
  for (const { botId, ...item } of rows) {
    const previous = grouped.get(item.id)
    if (previous) previous.botIds.push(botId)
    else grouped.set(item.id, { ...item, botIds: [botId] })
  }
  return [...grouped.values()]
}
