import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { inArray } from 'drizzle-orm'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { project } from '../../src/modules/projects/projects.tables.ts'
import {
  agentTemplate,
  agentTemplateVersion,
  projectTemplateSelection,
  skill,
  skillVersion,
  templateSnapshotLink,
} from '../../src/modules/knowledge/knowledge.tables.ts'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import { createAuthenticatedUser } from './auth.ts'

export interface KnowledgeFixtureUser {
  cookie: string
  userId: string
}

export interface KnowledgeFixture {
  adminUser: KnowledgeFixtureUser
  devUser: KnowledgeFixtureUser
  viewerUser: KnowledgeFixtureUser
  otherUser: KnowledgeFixtureUser
  teamId: string
  otherTeamId: string
}

/**
 * 创建知识资产测试所需的团队、成员与跨团队账号。
 * @param app 已注入数据库的测试应用。
 * @returns 管理员/开发者/浏览者/其他团队账号与两个团队标识。
 * @remarks 调用方仍需自行创建项目；隔离测试库通常整库删除，无需调用 cleanup。
 */
export async function seedKnowledgeFixture(app: FastifyInstance): Promise<KnowledgeFixture> {
  const adminUser = await createAuthenticatedUser(app, { name: '管理员' })
  const devUser = await createAuthenticatedUser(app, { name: '开发者' })
  const viewerUser = await createAuthenticatedUser(app, { name: '浏览者' })
  const otherUser = await createAuthenticatedUser(app, { name: '其他团队' })
  const teamId = randomUUID()
  const otherTeamId = randomUUID()
  await app.db.insert(team).values([
    { id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId },
    { id: otherTeamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: otherUser.userId },
  ])
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: devUser.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
    { id: randomUUID(), team_id: otherTeamId, user_id: otherUser.userId, role: 'admin', status: 'active' },
  ])
  return { adminUser, devUser, viewerUser, otherUser, teamId, otherTeamId }
}

/**
 * 清理知识资产夹具产生的业务行与成员关系。
 * @param app 已注入数据库的测试应用。
 * @param fixture seedKnowledgeFixture 的返回值。
 * @returns 清理完成的 Promise；按子表到父表顺序删除。
 */
export async function cleanupKnowledgeFixture(app: FastifyInstance, fixture: KnowledgeFixture) {
  const teamIds = [fixture.teamId, fixture.otherTeamId]
  const templates = await app.db
    .select({ id: agentTemplate.id })
    .from(agentTemplate)
    .where(inArray(agentTemplate.team_id, teamIds))
  const skills = await app.db.select({ id: skill.id }).from(skill).where(inArray(skill.team_id, teamIds))
  await app.db.transaction(async (tx) => {
    await tx.delete(activity).where(inArray(activity.team_id, teamIds))
    if (templates.length > 0) {
      const templateIds = templates.map((row) => row.id)
      await tx.delete(templateSnapshotLink).where(inArray(templateSnapshotLink.template_id, templateIds))
      await tx.delete(projectTemplateSelection).where(inArray(projectTemplateSelection.template_id, templateIds))
      await tx.delete(agentTemplateVersion).where(inArray(agentTemplateVersion.template_id, templateIds))
      await tx.delete(agentTemplate).where(inArray(agentTemplate.id, templateIds))
    }
    if (skills.length > 0) {
      const skillIds = skills.map((row) => row.id)
      await tx.delete(skillVersion).where(inArray(skillVersion.skill_id, skillIds))
      await tx.delete(skill).where(inArray(skill.id, skillIds))
    }
    await tx.delete(project).where(inArray(project.team_id, teamIds))
    await tx.delete(teamMember).where(inArray(teamMember.team_id, teamIds))
    await tx.delete(team).where(inArray(team.id, teamIds))
  })
}
