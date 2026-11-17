import { sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Database } from '../../../platform/database/client.ts'
import { attachment } from '../../attachments/attachments.tables.ts'
import { bug } from '../../bugs/bugs.tables.ts'
import { codeReference } from '../../code/code.tables.ts'
import { botConversation } from '../../collaboration/bot-conversations.tables.ts'
import { buildRecord, externalReview } from '../../delivery/delivery.tables.ts'
import { gitConnection } from '../../integrations/integrations.tables.ts'
import { skill } from '../../knowledge/knowledge.tables.ts'
import { pipelineArtifact, pipelineNode, pipelineRun } from '../../pipeline/pipeline.tables.ts'
import { project } from '../../projects/projects.tables.ts'
import { requirement } from '../../requirements/requirements.tables.ts'
import { botTask } from '../../tasks/bot-tasks.tables.ts'
import { codeChange } from '../../tools/tools.tables.ts'
import { bot, botRun } from '../bots.tables.ts'

const TEAM_OWNED_RESOURCES: Readonly<Record<string, PgTable & { id: PgColumn; team_id: PgColumn }>> = {
  attachments: attachment,
  bots: bot,
  'bot-conversations': botConversation,
  'bot-runs': botRun,
  'bot-tasks': botTask,
  bugs: bug,
  builds: buildRecord,
  'code-references': codeReference,
  'git-connections': gitConnection,
  'pipeline-artifacts': pipelineArtifact,
  'pipeline-nodes': pipelineNode,
  'pipeline-runs': pipelineRun,
  projects: project,
  requirements: requirement,
  reviews: externalReview,
  skills: skill,
  'tools/code-changes': codeChange,
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * 校验显式团队或资源路径属于当前运行的团队；业务路由继续执行资源级授权。
 * @param db 提供资源归属查询的数据库。
 * @param teamId 当前运行团队。
 * @param template 由 OpenAPI 匹配的路径模板。
 * @param path 已经规范化且不带查询参数的路径。
 * @returns 是否通过团队边界检查。
 */
export async function isBotApiInTeam(db: Database, teamId: string, template: string, path: string) {
  const [, , , ...prefix] = template.split('/')
  const [, , , ...segments] = path.split('/')
  const [first, second, third] = segments
  if (first === 'teams') return second === teamId
  if (prefix[0] === 'platform') return false
  const namespace = first === 'tools' ? `${first}/${second}` : first
  const table = namespace ? TEAM_OWNED_RESOURCES[namespace] : undefined
  const resourceId = first === 'tools' ? third : second
  if (!table || (first === 'attachments' && resourceId === 'policy')) return true
  if (!resourceId || !UUID.test(resourceId)) return false
  const result = await db.execute(
    sql`select 1 from ${table} where ${table.id} = ${resourceId} and ${table.team_id} = ${teamId}`,
  )
  return result.rowCount === 1
}
