import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import type { SecretCipher } from './configuration.crypto.ts'
import { findSecretForDecrypt, insertSecret, listSecrets, revokeSecret } from './configuration.repository.ts'

const SECRET_KINDS = new Set(['git_token', 'github_app_private_key'])

export interface SecretMetadata {
  id: string
  kind: string
  name: string
  status: string
  keyVersion: number
  createdAt: string
}

export interface ConfigurationServiceDeps {
  db: Database
  cipher: SecretCipher
}

/**
 * 创建凭据配置服务。
 * @param deps 数据库与加解密器。
 * @returns 凭据创建、列表、撤销与内部解密用例。
 */
export function createConfigurationService(deps: ConfigurationServiceDeps) {
  const { db } = deps

  async function requireAdmin(actor: SessionUser, teamId: string) {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
  }

  function metadata(row: NonNullable<Awaited<ReturnType<typeof insertSecret>>>): SecretMetadata {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      status: row.status,
      keyVersion: row.key_version,
      createdAt: row.created_at.toISOString(),
    }
  }

  async function createSecret(
    actor: SessionUser,
    teamId: string,
    input: { kind: string; name: string; value: string },
  ): Promise<SecretMetadata> {
    await requireAdmin(actor, teamId)
    if (!SECRET_KINDS.has(input.kind)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据类型不合法')
    const name = input.name.trim()
    if (name.length === 0 || name.length > 120) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据名称长度不合法')
    if (input.value.length === 0 || input.value.length > 100_000)
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据内容长度不合法')
    const encrypted = deps.cipher.encrypt(input.value)
    const row = await insertSecret(db, {
      id: randomUUID(),
      teamId,
      kind: input.kind,
      name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      createdByUserId: actor.id,
    })
    if (!row) throw new Error('凭据保存失败')
    return metadata(row)
  }

  async function listTeamSecrets(actor: SessionUser, teamId: string): Promise<SecretMetadata[]> {
    await requireTeamMember(db, actor.id, teamId, ['admin'])
    const rows = await listSecrets(db, teamId)
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      status: row.status,
      keyVersion: row.keyVersion,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async function revokeTeamSecret(actor: SessionUser, teamId: string, secretId: string): Promise<SecretMetadata> {
    await requireAdmin(actor, teamId)
    const row = await revokeSecret(db, teamId, secretId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在或已撤销')
    return metadata(row)
  }

  async function decryptTeamSecret(teamId: string, secretId: string): Promise<string> {
    const row = await findSecretForDecrypt(db, teamId, secretId)
    if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在或已撤销')
    return deps.cipher.decrypt({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      keyVersion: row.key_version,
    })
  }

  return {
    createSecret,
    listSecrets: listTeamSecrets,
    revokeSecret: revokeTeamSecret,
    decryptSecret: decryptTeamSecret,
  }
}

export type ConfigurationService = ReturnType<typeof createConfigurationService>
