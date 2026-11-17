import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { insertActivity } from '../collaboration/collaboration.repository.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import { resolveModelApiKey } from '../configuration/configuration.model-key.ts'
import { credential } from '../configuration/configuration.tables.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { authUser } from '../identity/identity.tables.ts'
import { botCatalogSupports, listStoredBotModels } from './bots.catalog.ts'
import { suspendConnectionWork } from './bots.connections.repository.ts'
import type { BotModelConnectionView, ModelConnectionInput } from './bots.connections.schema.ts'
import { botModelConnection } from './bots.tables.ts'

type Row = typeof botModelConnection.$inferSelect

function connectionView(row: Row, loginUserName: string | null): BotModelConnectionView {
  if (row.auth_type !== 'api_key' && row.auth_type !== 'oauth') throw new Error('数据库中的模型连接类型不合法')
  if (row.status !== 'active' && row.status !== 'disabled' && row.status !== 'login_failed') {
    throw new Error('数据库中的模型连接状态不合法')
  }
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    authType: row.auth_type,
    status: row.status,
    version: row.version,
    disabledReason: row.disabled_reason,
    loginUserName,
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * 组装认证连接的读取、密钥创建和状态管理。
 * @param db 平台数据库。
 * @param cipher 团队凭据加密器；缺失时拒绝创建新密钥。
 * @returns 团队成员只读、管理员可写的连接用例。
 */
export function createBotConnectionsService(db: Database, cipher: SecretCipher | null) {
  return {
    /** 只读取当前团队连接的公开元数据，未经授权的订阅草稿不在目录中展示。 */
    async list(actor: SessionUser, teamId: string) {
      await requireTeamMember(db, actor.id, teamId)
      const rows = await db
        .select({ connection: botModelConnection, userName: authUser.name })
        .from(botModelConnection)
        .leftJoin(authUser, eq(authUser.id, botModelConnection.login_user_id))
        .where(
          and(
            eq(botModelConnection.team_id, teamId),
            or(
              eq(botModelConnection.status, 'active'),
              eq(botModelConnection.status, 'disabled'),
              eq(botModelConnection.disabled_reason, 'auth_expired'),
            ),
          ),
        )
        .orderBy(asc(botModelConnection.name), asc(botModelConnection.id))
        .limit(200)
      return rows.map(({ connection, userName }) => connectionView(connection, userName))
    },
    /** 返回同一份内置模型目录，检查访问人是团队成员。 */
    async catalog(actor: SessionUser, teamId: string, providerId?: string) {
      await requireTeamMember(db, actor.id, teamId)
      return listStoredBotModels(db, providerId)
    },
    /** 创建 API Key 连接，密钥引用与连接审计在同一事务内更新。 */
    async create(actor: SessionUser, teamId: string, input: ModelConnectionInput) {
      const name = input.name.trim()
      if (!name) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请输入连接名称')
      try {
        return await db.transaction(async (tx) => {
          await requireTeamMember(tx, actor.id, teamId, ['admin'])
          if (!(await botCatalogSupports(tx, input.providerId, 'api_key'))) {
            throw new ApiError(ERROR_CODES.BOT_MODEL_NOT_IN_CATALOG, '模型目录没有支持 API Key 的所选提供方')
          }
          const credentialId = await resolveModelApiKey(
            tx,
            {
              ...input,
              teamId,
              userId: actor.id,
              label: name,
            },
            cipher,
          )
          const [row] = await tx
            .insert(botModelConnection)
            .values({
              team_id: teamId,
              name,
              provider_id: input.providerId,
              auth_type: 'api_key',
              credential_id: credentialId,
              status: 'active',
            })
            .returning()
          if (!row) throw new Error('模型连接保存失败')
          await insertActivity(tx, {
            id: randomUUID(),
            teamId,
            entityType: 'bot_model_connection',
            entityId: row.id,
            projectId: null,
            actorUserId: actor.id,
            action: 'bot_model_connection_created',
            changes: { providerId: row.provider_id },
          })
          return connectionView(row, null)
        })
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '团队已经存在同名连接或模型密钥')
        throw error
      }
    },
    /** 管理员使用配置版本启用或停用模型连接，停用时通知所有关联运行。 */
    async setEnabled(actor: SessionUser, id: string, version: number, enabled: boolean) {
      return db.transaction(async (tx) => {
        const [scope] = await tx
          .select({ teamId: botModelConnection.team_id })
          .from(botModelConnection)
          .where(eq(botModelConnection.id, id))
        if (!scope) throw new ApiError(ERROR_CODES.NOT_FOUND, '模型连接不存在')
        await requireTeamMember(tx, actor.id, scope.teamId, ['admin'])
        const [connection] = await tx
          .select()
          .from(botModelConnection)
          .where(and(eq(botModelConnection.id, id), eq(botModelConnection.team_id, scope.teamId)))
          .for('update')
        if (!connection || connection.version !== version)
          throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '模型连接已修改')
        if (
          enabled &&
          connection.auth_type === 'oauth' &&
          (!connection.oauth_secret ||
            connection.disabled_reason === 'login_user_demoted' ||
            connection.disabled_reason === 'auth_expired')
        ) {
          throw new ApiError(ERROR_CODES.BOT_LOGIN_FAILED, '订阅连接需要重新登录')
        }
        if (enabled && connection.auth_type === 'api_key' && connection.credential_id) {
          const [key] = await tx
            .select({ id: credential.id })
            .from(credential)
            .where(
              and(
                eq(credential.id, connection.credential_id),
                eq(credential.team_id, scope.teamId),
                eq(credential.status, 'active'),
                or(isNull(credential.expires_at), gt(credential.expires_at, sql`clock_timestamp()`)),
              ),
            )
          if (!key) throw new ApiError(ERROR_CODES.CREDENTIAL_UNAVAILABLE, '模型密钥已失效')
        }
        const [updated] = await tx
          .update(botModelConnection)
          .set({
            status: enabled ? 'active' : 'disabled',
            disabled_reason: enabled ? null : (connection.disabled_reason ?? 'manual'),
            version: sql`${botModelConnection.version} + 1`,
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(botModelConnection.id, id), eq(botModelConnection.version, version)))
          .returning()
        if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '模型连接已修改')
        if (!enabled) await suspendConnectionWork(tx, scope.teamId, updated.id)
        await insertActivity(tx, {
          id: randomUUID(),
          teamId: scope.teamId,
          entityType: 'bot_model_connection',
          entityId: updated.id,
          projectId: null,
          actorUserId: actor.id,
          action: enabled ? 'bot_model_connection_enabled' : 'bot_model_connection_disabled',
        })
        const [user] = updated.login_user_id
          ? await tx.select({ name: authUser.name }).from(authUser).where(eq(authUser.id, updated.login_user_id))
          : []
        return connectionView(updated, user?.name ?? null)
      })
    },
  }
}

export type BotConnectionsService = ReturnType<typeof createBotConnectionsService>
