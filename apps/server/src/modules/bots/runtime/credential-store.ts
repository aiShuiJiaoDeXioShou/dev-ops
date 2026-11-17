import { setTimeout as delay } from 'node:timers/promises'
import type { CredentialOptions, CredentialStore, ModelCredential } from '@dev-ops/devops-bot'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import type { SecretCipher } from '../../configuration/configuration.crypto.ts'
import { credential, credentialVersion } from '../../configuration/configuration.tables.ts'
import { botModelConnection } from '../bots.tables.ts'

const encryptedSecretSchema = Type.Object({
  ciphertext: Type.String(),
  iv: Type.String(),
  authTag: Type.String(),
  keyVersion: Type.Integer({ minimum: 1 }),
})
const oauthCredentialSchema = Type.Object({
  type: Type.Literal('oauth'),
  access: Type.String(),
  refresh: Type.String(),
  expires: Type.Number(),
})

type CredentialDatabase = Pick<Database, 'select' | 'update'>
type ConnectionOptions = { db: Database; cipher: SecretCipher | null; teamId: string; connectionId: string }

function parseSecret(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // JSON 解析异常可能截取输入原文，避免把密文或解密后的令牌带入异常。
    throw new Error('数据库中的 Bot 授权凭据格式不合法')
  }
}

function decodeOAuth(cipher: SecretCipher, serialized: string): ModelCredential {
  const secret = parseSecret(serialized)
  if (!Check(encryptedSecretSchema, secret)) throw new Error('数据库中的 Bot 授权密文格式不合法')
  const decoded = parseSecret(cipher.decrypt(secret))
  if (!Check(oauthCredentialSchema, decoded)) throw new Error('数据库中的 Bot 订阅凭据格式不合法')
  return decoded
}

/**
 * 创建只访问当前团队与当前模型连接的凭据端口。
 * @param options 数据库、凭据加密器和连接归属。
 * @returns 读取、枚举与带版本写回的凭据端口；加密错误和并发冲突向上层传播。
 */
export function createPgCredentialStore(options: ConnectionOptions): CredentialStore {
  const { db, cipher, teamId, connectionId } = options
  const key = `bot-credential:${connectionId}`

  const connectionScope = and(eq(botModelConnection.id, connectionId), eq(botModelConnection.team_id, teamId))

  async function readConnection(reader: CredentialDatabase, providerId?: string) {
    const [row] = await reader
      .select({
        providerId: botModelConnection.provider_id,
        authType: botModelConnection.auth_type,
        credentialId: botModelConnection.credential_id,
        oauthSecret: botModelConnection.oauth_secret,
        status: botModelConnection.status,
        version: botModelConnection.version,
      })
      .from(botModelConnection)
      .where(
        and(connectionScope, providerId === undefined ? undefined : eq(botModelConnection.provider_id, providerId)),
      )
    return row
  }

  async function readCredential(reader: CredentialDatabase, connection: Awaited<ReturnType<typeof readConnection>>) {
    if (!connection || connection.status !== 'active' || !cipher) return undefined
    if (connection.authType === 'oauth' && connection.oauthSecret) return decodeOAuth(cipher, connection.oauthSecret)
    if (connection.authType !== 'api_key' || !connection.credentialId) return undefined
    const [secret] = await reader
      .select({
        ciphertext: credentialVersion.ciphertext,
        iv: credentialVersion.iv,
        authTag: credentialVersion.auth_tag,
        keyVersion: credentialVersion.key_version,
      })
      .from(credential)
      .innerJoin(
        credentialVersion,
        and(
          eq(credentialVersion.credential_id, credential.id),
          eq(credentialVersion.team_id, teamId),
          eq(credentialVersion.version, credential.current_version),
        ),
      )
      .where(
        and(
          eq(credential.id, connection.credentialId),
          eq(credential.team_id, teamId),
          eq(credential.kind, 'model_api_key'),
          eq(credential.status, 'active'),
          or(isNull(credential.expires_at), gt(credential.expires_at, sql`clock_timestamp()`)),
        ),
      )
    return secret && { type: 'api_key' as const, key: cipher.decrypt(secret) }
  }

  async function serialize<Result>(
    signal: AbortSignal | undefined,
    act: (locked: CredentialDatabase) => Promise<Result>,
  ) {
    const deadline = AbortSignal.timeout(15_000)
    const lockSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    lockSignal.throwIfAborted()
    const client = await db.$client.connect()
    try {
      // 锁只保护同一连接的刷新回调，网络刷新期间不打开数据库事务。
      for (;;) {
        lockSignal.throwIfAborted()
        const result = await client.query<{ acquired: boolean }>(
          'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
          [key],
        )
        if (result.rows[0]?.acquired) break
        await delay(100, undefined, { signal: lockSignal })
      }
      return await act(drizzle(client))
    } finally {
      // 回收专用连接会释放会话级锁，异常时也不会把持锁连接放回连接池。
      client.release(true)
    }
  }

  return {
    /** 读取当前提供方的执行凭据，停用、缺失或不匹配时返回 undefined。 */
    async read(providerId: string, settings?: CredentialOptions) {
      settings?.signal?.throwIfAborted()
      const result = await readCredential(db, await readConnection(db, providerId))
      settings?.signal?.throwIfAborted()
      return result
    },
    /** 返回当前连接的可用凭据类型，结果仅包含公开元数据。 */
    async list(settings?: CredentialOptions) {
      settings?.signal?.throwIfAborted()
      const row = await readConnection(db)
      if (row?.status !== 'active') return []
      if (row.authType === 'api_key' && row.credentialId) return [{ providerId: row.providerId, type: 'api_key' }]
      if (row.authType === 'oauth' && row.oauthSecret) return [{ providerId: row.providerId, type: 'oauth' }]
      return []
    },
    /** 串行刷新订阅凭据，只允许稳定版本写回。共享 API Key 由团队凭据库管理。 */
    async modify(providerId, update, settings) {
      return serialize(settings?.signal, async (locked) => {
        const row = await readConnection(locked, providerId)
        const current = await readCredential(locked, row)
        const next = await update(current)
        settings?.signal?.throwIfAborted()
        if (next === undefined) return current
        if (!row || !cipher || row.authType !== 'oauth' || next.type !== 'oauth') {
          throw new Error('当前连接不允许通过模型运行时更新凭据')
        }
        const [saved] = await locked
          .update(botModelConnection)
          .set({
            oauth_secret: JSON.stringify(cipher.encrypt(JSON.stringify(next))),
            status: 'active',
            disabled_reason: null,
            version: sql`${botModelConnection.version} + 1`,
            updated_at: sql`clock_timestamp()`,
          })
          .where(
            and(connectionScope, eq(botModelConnection.version, row.version), eq(botModelConnection.status, 'active')),
          )
          .returning({ id: botModelConnection.id })
        if (!saved) throw new Error('模型连接已被更新，刷新结果已丢弃')
        return next
      })
    },
    /** 串行移除当前连接的 OAuth 凭据并标记须重新登录。 */
    async delete(providerId, settings) {
      await serialize(settings?.signal, async (locked) => {
        const row = await readConnection(locked, providerId)
        if (!row || row.authType !== 'oauth' || row.status !== 'active') return
        settings?.signal?.throwIfAborted()
        const result = await locked
          .update(botModelConnection)
          .set({
            oauth_secret: null,
            status: 'login_failed',
            disabled_reason: 'auth_expired',
            version: sql`${botModelConnection.version} + 1`,
            updated_at: sql`clock_timestamp()`,
          })
          .where(
            and(connectionScope, eq(botModelConnection.version, row.version), eq(botModelConnection.status, 'active')),
          )
        if (result.rowCount !== 1) throw new Error('模型连接已被更新，未移除凭据')
      })
    },
  }
}
