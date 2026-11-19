import { countMcpTools, type BotMcpServer } from '@dev-ops/devops-bot'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../../../platform/database/client.ts'
import type { SecretCipher } from '../../configuration/configuration.crypto.ts'
import { credential, credentialVersion } from '../../configuration/configuration.tables.ts'
import { botMcpServer } from '../bots.platform.tables.ts'
import { fetchBotMcp } from './mcp-fetch.ts'

type ServerFields = Pick<typeof botMcpServer.$inferSelect, 'name' | 'url' | 'credential_id' | 'exposure'>

async function connection(
  db: Database,
  cipher: SecretCipher | null,
  teamId: string,
  row: ServerFields,
): Promise<BotMcpServer> {
  if (row.exposure !== 'direct' && row.exposure !== 'deferred') throw new Error('MCP 工具暴露方式不合法')
  const headers: Record<string, string> = {}
  if (row.credential_id) {
    if (!cipher) throw new Error('团队凭据加密配置不可用')
    const [secret] = await db
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
          eq(credentialVersion.team_id, credential.team_id),
          eq(credentialVersion.version, credential.current_version),
        ),
      )
      .where(
        and(
          eq(credential.id, row.credential_id),
          eq(credential.team_id, teamId),
          eq(credential.status, 'active'),
          eq(credential.kind, 'api_key'),
          or(isNull(credential.expires_at), gt(credential.expires_at, sql`clock_timestamp()`)),
        ),
      )
    if (!secret) throw new Error('MCP 的团队凭据已不可用')
    const value = cipher.decrypt(secret)
    if (!value || !/^[\x21-\x7e]+$/u.test(value)) throw new Error('MCP 的团队凭据格式不合法')
    headers.Authorization = `Bearer ${value}`
  }
  return { name: row.name, url: row.url, headers, exposure: row.exposure }
}

/**
 * 读取给予当前 Bot 的远程服务器。只在执行进程中解密当前有效的凭据。
 * @param db 执行进程数据库。
 * @param cipher 团队凭据解密器。
 * @param teamId 当前运行团队。
 * @param botId 当前运行 Bot。
 * @returns 可用服务器配置；已撤销或超期的凭据使该服务不可用。
 */
export async function readBotMcpServers(db: Database, cipher: SecretCipher | null, teamId: string, botId: string) {
  const rows = await db
    .select({
      name: botMcpServer.name,
      url: botMcpServer.url,
      credential_id: botMcpServer.credential_id,
      exposure: botMcpServer.exposure,
    })
    .from(botMcpServer)
    .where(
      and(
        eq(botMcpServer.team_id, teamId),
        eq(botMcpServer.status, 'enabled'),
        sql`${botMcpServer.bot_ids} @> ${JSON.stringify([botId])}::jsonb`,
      ),
    )
    .limit(20)
  const results = await Promise.allSettled(rows.map((row) => connection(db, cipher, teamId, row)))
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

/**
 * 使用同一公网传输验证管理员配置的 MCP 工作能力。
 * @param db 平台数据库。
 * @param cipher 团队凭据解密器。
 * @param teamId 服务器所属团队。
 * @param row 已授权的服务配置。
 * @returns 工具数量，以及经过归类的失败状态。
 */
export async function tryBotMcpConnection(
  db: Database,
  cipher: SecretCipher | null,
  teamId: string,
  row: ServerFields,
) {
  try {
    return { isConnected: true, toolCount: await countMcpTools(await connection(db, cipher, teamId, row), fetchBotMcp) }
  } catch {
    return { isConnected: false, toolCount: 0, failureMessage: '服务不可达、凭据不可用或无法发现工具' }
  }
}
