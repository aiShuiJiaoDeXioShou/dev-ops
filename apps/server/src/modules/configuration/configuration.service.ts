import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { createCredentialsService } from './configuration.credentials.service.ts'
import type { SecretCipher } from './configuration.crypto.ts'
import { createEnvironmentVariablesService } from './configuration.environment-variables.service.ts'
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
  /** 会话密码二次校验；由身份模块注入，配置模块不直接依赖认证实现。 */
  verifyPassword: (headers: IncomingHttpHeaders, password: string) => Promise<boolean>
}

/**
 * 按团队和凭据标识解密有效 Git 凭据，供已校验连接归属的服务端用例使用。
 * @param db 数据库连接。
 * @param cipher 凭据加解密器。
 * @param teamId 连接所属团队。
 * @param secretId 团队内的凭据标识。
 * @returns 凭据明文，由调用方限制在适配器生命周期内使用。
 * @throws 凭据缺失、已经撤销或解密失败时抛出。
 */
export async function decryptConfiguredSecret(
  db: Database,
  cipher: SecretCipher,
  teamId: string,
  secretId: string,
): Promise<string> {
  const row = await findSecretForDecrypt(db, teamId, secretId)
  if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, '凭据不存在或已撤销')
  return cipher.decrypt({
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
  })
}

/**
 * 创建凭据配置服务。
 * @param deps 数据库、加解密器与密码二次校验依赖。
 * @returns 凭据创建、列表、撤销、明文查看与内部解密用例。
 */
export function createConfigurationService(deps: ConfigurationServiceDeps) {
  const { db } = deps
  // 凭据库与环境变量复用同一 AES-256-GCM 加解密器；Git 连接凭据仍走 V0.1 受控存储。
  const credentials = createCredentialsService(deps)
  const environmentVariables = createEnvironmentVariablesService({ db })

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

  /**
   * 解密团队中的有效凭据，供服务端内部使用。
   * @param teamId 连接所属团队。
   * @param secretId 团队内凭据标识。
   * @returns 凭据明文；无权访问的记录或解密失败时拒绝。
   */
  function decryptSecret(teamId: string, secretId: string): Promise<string> {
    return decryptConfiguredSecret(db, deps.cipher, teamId, secretId)
  }

  return {
    createSecret,
    listSecrets: listTeamSecrets,
    revokeSecret: revokeTeamSecret,
    decryptSecret,
    credentials,
    environmentVariables,
  }
}

export type ConfigurationService = ReturnType<typeof createConfigurationService>
