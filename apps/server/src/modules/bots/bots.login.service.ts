import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { apiResponseSchema } from '../../platform/http/response.ts'
import { insertActivity } from '../collaboration/collaboration.repository.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { botCatalogSupports } from './bots.catalog.ts'
import type { StartLoginInput } from './bots.connections.schema.ts'
import { botLoginSession, botModelConnection } from './bots.tables.ts'

const LOGIN_TIMEOUT_SECONDS = 600
const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const promptSchema = Type.Object({
  url: Type.Optional(Type.String()),
  userCode: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  question: Type.Optional(
    Type.Object({
      kind: Type.Union([
        Type.Literal('text'),
        Type.Literal('secret'),
        Type.Literal('manual_code'),
        Type.Literal('select'),
      ]),
      message: Type.String(),
      placeholder: Type.Optional(Type.String()),
      options: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String(),
            label: Type.String(),
            description: Type.Optional(Type.String()),
          }),
        ),
      ),
    }),
  ),
})

export const loginSessionParams = Type.Object({ sessionId: uuid })
export const loginSessionCreated = apiResponseSchema(Type.Object({ loginSessionId: uuid }))
export const loginAnswerBody = Type.Object(
  { value: Type.String({ minLength: 1, maxLength: 4096 }) },
  { additionalProperties: false },
)
const loginSessionViewSchema = Type.Object({
  id: uuid,
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('waiting_user'),
    Type.Literal('succeeded'),
    Type.Literal('failed'),
    Type.Literal('expired'),
  ]),
  expiresAt: Type.String(),
  prompt: Type.Union([promptSchema, Type.Null()]),
})

export const loginSessionResponse = apiResponseSchema(loginSessionViewSchema)

const pendingStatuses = ['pending', 'waiting_user']

type LoginRow = Pick<typeof botLoginSession.$inferSelect, 'id' | 'team_id' | 'status' | 'prompt' | 'expires_at'>
type SelectDb = Pick<Database, 'select'>

async function ownedSession(db: SelectDb, actor: SessionUser, sessionId: string): Promise<LoginRow> {
  const [session] = await db
    .select({
      id: botLoginSession.id,
      team_id: botLoginSession.team_id,
      prompt: botLoginSession.prompt,
      status: botLoginSession.status,
      expires_at: botLoginSession.expires_at,
    })
    .from(botLoginSession)
    .innerJoin(
      botModelConnection,
      and(
        eq(botModelConnection.id, botLoginSession.connection_id),
        eq(botModelConnection.team_id, botLoginSession.team_id),
        eq(botModelConnection.login_user_id, actor.id),
      ),
    )
    .where(eq(botLoginSession.id, sessionId))
  if (!session) throw new ApiError(ERROR_CODES.NOT_FOUND, '登录会话不存在')
  await requireTeamMember(db, actor.id, session.team_id, ['admin'])
  return session
}

function loginView(row: LoginRow): Static<typeof loginSessionViewSchema> {
  const { status } = row
  if (
    status !== 'pending' &&
    status !== 'waiting_user' &&
    status !== 'succeeded' &&
    status !== 'failed' &&
    status !== 'expired'
  ) {
    throw new Error('数据库中的订阅登录状态不合法')
  }
  const isExpired = pendingStatuses.includes(status) && row.expires_at.getTime() <= Date.now()
  return {
    id: row.id,
    status: isExpired ? ('expired' as const) : status,
    expiresAt: row.expires_at.toISOString(),
    prompt: !isExpired && Check(promptSchema, row.prompt) ? row.prompt : null,
  }
}

/**
 * 创建订阅授权中转服务，授权码密文只在短期登录会话内交给执行进程。
 * @param db 平台数据库。
 * @param cipher 会话回调码与令牌加解密器。
 * @returns 只向发起管理员提供登录交互的用例。
 */
export function createBotLoginService(db: Database, cipher: SecretCipher | null) {
  return {
    /** 申请订阅授权，失败后可重试同名未完成连接。 */
    async start(actor: SessionUser, teamId: string, input: StartLoginInput) {
      const name = input.name.trim()
      if (!name) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请输入连接名称')
      if (!cipher) throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '服务端尚未配置凭据加密')
      try {
        return await db.transaction(async (tx) => {
          await requireTeamMember(tx, actor.id, teamId, ['admin'])
          if (!(await botCatalogSupports(tx, input.providerId, 'oauth'))) {
            throw new ApiError(ERROR_CODES.BOT_MODEL_NOT_IN_CATALOG, '所选提供方不支持订阅连接')
          }
          const [existing] = await tx
            .select()
            .from(botModelConnection)
            .where(and(eq(botModelConnection.team_id, teamId), eq(botModelConnection.name, name)))
            .for('update')
          let connectionId = existing?.id
          if (existing) {
            if (
              existing.auth_type !== 'oauth' ||
              existing.login_user_id !== actor.id ||
              existing.provider_id !== input.providerId ||
              existing.status === 'active'
            ) {
              throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '团队已存在同名模型连接')
            }
            const [session] = await tx
              .select({ id: botLoginSession.id })
              .from(botLoginSession)
              .where(
                and(
                  eq(botLoginSession.team_id, teamId),
                  eq(botLoginSession.connection_id, existing.id),
                  inArray(botLoginSession.status, pendingStatuses),
                  gt(botLoginSession.expires_at, sql`clock_timestamp()`),
                ),
              )
              .orderBy(desc(botLoginSession.created_at))
              .limit(1)
            if (session) return { loginSessionId: session.id }
            await tx
              .update(botModelConnection)
              .set({
                status: 'login_failed',
                oauth_secret: null,
                disabled_reason: null,
                version: sql`${botModelConnection.version} + 1`,
                updated_at: sql`clock_timestamp()`,
              })
              .where(eq(botModelConnection.id, existing.id))
          } else {
            const [created] = await tx
              .insert(botModelConnection)
              .values({
                team_id: teamId,
                name,
                auth_type: 'oauth',
                provider_id: input.providerId,
                login_user_id: actor.id,
                status: 'login_failed',
              })
              .returning({ id: botModelConnection.id })
            connectionId = created?.id
          }
          if (!connectionId) throw new Error('订阅连接初始化失败')
          const [created] = await tx
            .insert(botLoginSession)
            .values({
              team_id: teamId,
              connection_id: connectionId,
              expires_at: sql`clock_timestamp() + ${LOGIN_TIMEOUT_SECONDS} * interval '1 second'`,
            })
            .returning({ id: botLoginSession.id })
          if (!created) throw new Error('登录交互初始化失败')
          await insertActivity(tx, {
            id: randomUUID(),
            teamId,
            entityId: connectionId,
            projectId: null,
            entityType: 'bot_model_connection',
            actorUserId: actor.id,
            action: 'bot_subscription_login_started',
            changes: { providerId: input.providerId },
          })
          return { loginSessionId: created.id }
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(ERROR_CODES.DUPLICATE_RELATION, '团队已存在同名模型连接')
        throw error
      }
    },
    /** 查询授权链接、设备提示或完成状态，只对发起者开放。 */
    async get(actor: SessionUser, sessionId: string) {
      return loginView(await ownedSession(db, actor, sessionId))
    },
    /** 单次提交授权步骤要求的输入，重试不能覆盖已暂存的回答。 */
    async answer(actor: SessionUser, sessionId: string, value: string) {
      const session = await ownedSession(db, actor, sessionId)
      if (!cipher || !Check(promptSchema, session.prompt) || !session.prompt.question || !value.trim()) {
        throw new ApiError(ERROR_CODES.BOT_LOGIN_FAILED, '当前登录未等待输入')
      }
      const [updated] = await db
        .update(botLoginSession)
        .set({
          answer_secret: JSON.stringify(cipher.encrypt(value.trim())),
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(botLoginSession.id, sessionId),
            eq(botLoginSession.team_id, session.team_id),
            eq(botLoginSession.status, 'waiting_user'),
            gt(botLoginSession.expires_at, sql`clock_timestamp()`),
            isNull(botLoginSession.answer_secret),
            sql`${botLoginSession.prompt} ? 'question'`,
          ),
        )
        .returning()
      if (!updated) throw new ApiError(ERROR_CODES.BOT_LOGIN_FAILED, '已提交或登录会话已失效')
      return loginView(updated)
    },
    /** 取消仍可操作的登录步骤，并立即清除待消费的授权码。 */
    async cancel(actor: SessionUser, sessionId: string) {
      const session = await ownedSession(db, actor, sessionId)
      const [updated] = await db
        .update(botLoginSession)
        .set({
          status: 'failed',
          prompt: null,
          answer_secret: null,
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(botLoginSession.id, sessionId),
            eq(botLoginSession.team_id, session.team_id),
            inArray(botLoginSession.status, pendingStatuses),
          ),
        )
        .returning()
      return loginView(updated ?? session)
    },
  }
}

export type BotLoginService = ReturnType<typeof createBotLoginService>
