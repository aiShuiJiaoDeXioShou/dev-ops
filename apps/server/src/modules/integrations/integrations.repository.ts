import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.js'
import { gitConnection } from './integrations.tables.js'

/** 插入 Git 连接。 */
export async function insertGitConnection(
  db: Database,
  input: {
    id: string
    teamId: string
    providerKey: string
    instanceUrl: string
    name: string
    authKind: string
    secretId: string | null
    externalIdentity: string | null
    createdByUserId: string
  },
) {
  const [row] = await db
    .insert(gitConnection)
    .values({
      id: input.id,
      team_id: input.teamId,
      provider_key: input.providerKey,
      instance_url: input.instanceUrl,
      name: input.name,
      auth_kind: input.authKind,
      secret_id: input.secretId,
      external_identity: input.externalIdentity,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  return row
}

/** 按标识查询连接。 */
export async function findGitConnectionById(db: Database, connectionId: string) {
  const [row] = await db.select().from(gitConnection).where(eq(gitConnection.id, connectionId)).limit(1)
  return row
}

/** 列出团队连接。 */
export async function findGitConnections(db: Database, teamId: string) {
  return db
    .select()
    .from(gitConnection)
    .where(eq(gitConnection.team_id, teamId))
    .orderBy(desc(gitConnection.created_at), desc(gitConnection.id))
}

/** 列出团队可用连接标识。 */
export async function findActiveConnectionIds(db: Database, teamId: string) {
  const rows = await db
    .select({ id: gitConnection.id })
    .from(gitConnection)
    .where(and(eq(gitConnection.team_id, teamId), eq(gitConnection.status, 'active')))
  return rows.map((row) => row.id)
}

/** 更新连接状态与检查信息。 */
export async function updateGitConnection(
  db: Database,
  connectionId: string,
  values: {
    status?: string
    externalIdentity?: string | null
    lastCheckedAt?: Date
    lastErrorCode?: string | null
    repositoryScopeSyncedAt?: Date
    name?: string
  },
) {
  const [row] = await db
    .update(gitConnection)
    .set({
      ...(values.status === undefined ? {} : { status: values.status }),
      ...(values.externalIdentity === undefined ? {} : { external_identity: values.externalIdentity }),
      ...(values.lastCheckedAt === undefined ? {} : { last_checked_at: values.lastCheckedAt }),
      ...(values.lastErrorCode === undefined ? {} : { last_error_code: values.lastErrorCode }),
      ...(values.repositoryScopeSyncedAt === undefined
        ? {}
        : { repository_scope_synced_at: values.repositoryScopeSyncedAt }),
      ...(values.name === undefined ? {} : { name: values.name }),
      updated_at: new Date(),
    })
    .where(eq(gitConnection.id, connectionId))
    .returning()
  return row
}
