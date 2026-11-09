import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.js'
import { secret } from './configuration.tables.js'

/** 插入加密凭据。 */
export async function insertSecret(
  db: Database,
  input: {
    id: string
    teamId: string
    kind: string
    name: string
    ciphertext: string
    iv: string
    authTag: string
    keyVersion: number
    createdByUserId: string
  },
) {
  const [row] = await db
    .insert(secret)
    .values({
      id: input.id,
      team_id: input.teamId,
      kind: input.kind,
      name: input.name,
      ciphertext: input.ciphertext,
      iv: input.iv,
      auth_tag: input.authTag,
      key_version: input.keyVersion,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  return row
}

/** 列出团队凭据元数据，不返回密文。 */
export async function listSecrets(db: Database, teamId: string) {
  return db
    .select({
      id: secret.id,
      kind: secret.kind,
      name: secret.name,
      status: secret.status,
      keyVersion: secret.key_version,
      createdAt: secret.created_at,
    })
    .from(secret)
    .where(eq(secret.team_id, teamId))
    .orderBy(desc(secret.created_at), desc(secret.id))
}

/** 查询可解密凭据内部行。 */
export async function findSecretForDecrypt(db: Database, teamId: string, secretId: string) {
  const [row] = await db
    .select()
    .from(secret)
    .where(and(eq(secret.id, secretId), eq(secret.team_id, teamId), eq(secret.status, 'active')))
    .limit(1)
  return row
}

/** 撤销凭据。 */
export async function revokeSecret(db: Database, teamId: string, secretId: string) {
  const [row] = await db
    .update(secret)
    .set({ status: 'revoked', updated_at: new Date() })
    .where(and(eq(secret.id, secretId), eq(secret.team_id, teamId), eq(secret.status, 'active')))
    .returning()
  return row
}
