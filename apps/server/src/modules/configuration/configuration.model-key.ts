import { randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { SecretCipher } from './configuration.crypto.ts'
import {
  insertCredential,
  insertCredentialUsage,
  insertCredentialVersion,
} from './configuration.credentials.repository.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { credential } from './configuration.tables.ts'
import { validateCredentialValue } from './configuration.validators.ts'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * 在模型连接的事务中验证归属和类型，或以标准凭据版本结构创建新模型密钥。
 * @param tx 新连接使用的事务。
 * @param input 团队、操作者、显示名称以及待引用或创建的密钥。
 * @param cipher 写入密钥使用的团队凭据加密器。
 * @returns 同团队的凭据标识；引用无效、加密配置不足、输入非法或写入失败时抛错。
 */
export async function resolveModelApiKey(
  tx: Transaction,
  input: { teamId: string; userId: string; label: string } & ({ credentialId: string } | { apiKey: string }),
  cipher: SecretCipher | null,
) {
  if ('credentialId' in input) {
    const [row] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.id, input.credentialId),
          eq(credential.team_id, input.teamId),
          eq(credential.kind, 'model_api_key'),
          eq(credential.status, 'active'),
          or(isNull(credential.expires_at), gt(credential.expires_at, sql`clock_timestamp()`)),
        ),
      )
      .for('update')
    if (!row) throw new ApiError(ERROR_CODES.CREDENTIAL_UNAVAILABLE, '请选择本团队可用的模型密钥')
    return row.id
  }
  if (!cipher) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '服务端尚未配置凭据加密')
  const value = validateCredentialValue(input.apiKey)
  const encrypted = cipher.encrypt(value)
  const id = randomUUID()
  const name = `${input.label}（模型密钥）`
  await insertCredential(tx, {
    id,
    teamId: input.teamId,
    name,
    kind: 'model_api_key',
    description: null,
    expiresAt: null,
    createdByUserId: input.userId,
  })
  await insertCredentialVersion(tx, {
    id: randomUUID(),
    teamId: input.teamId,
    credentialId: id,
    version: 1,
    rotatedFromVersion: null,
    ...encrypted,
    createdByUserId: input.userId,
  })
  await insertCredentialUsage(tx, {
    id: randomUUID(),
    teamId: input.teamId,
    credentialId: id,
    credentialVersion: 1,
    projectId: null,
    environment: null,
    action: 'create',
    actorUserId: input.userId,
    result: 'success',
    errorCode: null,
  })
  await appendActivity(tx, {
    teamId: input.teamId,
    entityType: 'credential',
    entityId: id,
    action: 'credential_created',
    actorUserId: input.userId,
    changes: { kind: 'model_api_key', name },
  })
  return id
}
